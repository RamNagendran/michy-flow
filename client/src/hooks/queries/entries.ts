import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { Paginated } from '../../types/auth'
import type { EntryAction, EntryBodyFor, EntryDetail, EntryQuery, EntryRow, EntryType, StatusCount } from '../../types/entries'
import { useNotify } from '../useNotify'

export const entryKeys = {
  all: ['entries'] as const,
  list: (q: EntryQuery) => [...entryKeys.all, 'list', q] as const,
  one: (companyId: number, type: string, id: number) => [...entryKeys.all, 'one', companyId, type, id] as const,
}

/** Everything worked out from entries: stock, totals, reports and wastage. */
export const DERIVED_KEYS = ['stock', 'summary', 'status-summary', 'trends', 'oil-kpi', 'prices', 'production-report', 'wastage', 'debit-notes', 'stock-checks'] as const

/** Anything that changes an entry also changes stock, period totals and the reports. */
export function useInvalidateEntries() {
  const qc = useQueryClient()
  return () => Promise.all([entryKeys.all, ...DERIVED_KEYS.map((k) => [k])].map((queryKey) => qc.invalidateQueries({ queryKey })))
}

/** Count and value of the visible entries per status (operators: their own). */
export function useStatusSummary(query: Pick<EntryQuery, 'type' | 'company_id' | 'date_from' | 'date_to'>, enabled = true) {
  return useQuery({
    queryKey: ['status-summary', query],
    queryFn: async () => (await api.get<StatusCount[]>(API_ROUTES.entries.statusSummary, { params: query })).data,
    placeholderData: keepPreviousData,
    enabled,
  })
}

/** The Manager sends an entry back to the in-charge, or Finance sends it back to the Manager. */
export function useEscalation() {
  const notify = useNotify()
  const invalidate = useInvalidateEntries()
  return useMutation({
    mutationFn: async ({ entry, comment }: { entry: EntryDetail; comment: string }) =>
      (await api.post<EntryDetail>(API_ROUTES.entries.escalate(entry.company_id, entry.type, entry.id), { comment })).data,
    onSuccess: (e) => {
      notify.success(e.escalated_to === 'incharge' ? 'Sent back to the in-charge' : 'Sent back to the Manager', e.ref_no)
      // Refresh lists in the background: the save is done, so the form can close now.
      void invalidate()
    },
    onError: (err) => notify.error(err, 'Could not update the entry'),
  })
}

export function useEntries(query: EntryQuery, enabled = true) {
  return useQuery({
    queryKey: entryKeys.list(query),
    queryFn: async () => (await api.get<Paginated<EntryRow>>(API_ROUTES.entries.list, { params: query })).data,
    placeholderData: keepPreviousData,
    enabled,
  })
}

export function useEntry(ref: { companyId: number; type: EntryType; id: number } | null) {
  return useQuery({
    queryKey: ref ? entryKeys.one(ref.companyId, ref.type, ref.id) : ['entries', 'none'],
    queryFn: async () => (await api.get<EntryDetail>(API_ROUTES.entries.one(ref!.companyId, ref!.type, ref!.id))).data,
    enabled: !!ref,
  })
}

export function useCreateEntry<T extends EntryType>(type: T) {
  const invalidate = useInvalidateEntries()
  return useMutation({
    mutationFn: async ({ companyId, body }: { companyId: number; body: EntryBodyFor[T] }) =>
      (await api.post<EntryDetail>(API_ROUTES.entries.create(companyId, type), body)).data,
    onSuccess: () => invalidate(),
  })
}

export function useUpdateEntry<T extends EntryType>(type: T) {
  const notify = useNotify()
  const invalidate = useInvalidateEntries()
  return useMutation({
    mutationFn: async ({ companyId, id, body }: { companyId: number; id: number; body: EntryBodyFor[T] & { comment?: string } }) =>
      (await api.put<EntryDetail>(API_ROUTES.entries.update(companyId, type, id), body)).data,
    onSuccess: (e) => {
      notify.success('Entry changed', `${e.ref_no} goes to the Manager again`)
      // Refresh lists in the background: the save is done, so the form can close now.
      void invalidate()
    },
  })
}

const actionDone: Record<EntryAction, string> = {
  approve: 'Approved. Sent to Finance',
  request_change: 'Sent to the Super Admin',
  verify: 'Approved. This entry is final',
  reject: 'Rejected',
}

export function useEntryAction() {
  const notify = useNotify()
  const invalidate = useInvalidateEntries()
  return useMutation({
    mutationFn: async ({ entry, action, comment }: { entry: EntryDetail; action: EntryAction; comment: string }) =>
      (await api.post<EntryDetail>(API_ROUTES.entries.action(entry.company_id, entry.type, entry.id, action), { comment })).data,
    onSuccess: (e, { action }) => {
      notify.success(actionDone[action], e.ref_no)
      // Refresh lists in the background: the save is done, so the form can close now.
      void invalidate()
    },
    onError: (err) => notify.error(err, 'Could not update the entry'),
  })
}

export function useCommentOnEntry() {
  const notify = useNotify()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ entry, comment }: { entry: EntryDetail; comment: string }) =>
      (await api.post<EntryDetail>(API_ROUTES.entries.comments(entry.company_id, entry.type, entry.id), { comment })).data,
    onSuccess: (e) => qc.setQueryData(entryKeys.one(e.company_id, e.type, e.id), e),
    onError: (err) => notify.error(err, 'Could not add the comment'),
  })
}
