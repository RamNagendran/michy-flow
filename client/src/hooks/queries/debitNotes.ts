import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { DebitNote, DebitNoteInput, EntryDetail } from '../../types/entries'
import { useNotify } from '../useNotify'
import { entryKeys, useInvalidateEntries } from './entries'

/** A supplier's debit notes still to come off a bill, oldest first. */
export function useOpenDebitNotes(companyId: number | undefined, supplierId: number | undefined) {
  return useQuery({
    queryKey: ['debit-notes', companyId, 'open', supplierId],
    queryFn: async () => (await api.get<DebitNote[]>(API_ROUTES.debitNotes.list(companyId!), { params: { supplier_id: supplierId, open: true } })).data,
    enabled: !!companyId && !!supplierId,
  })
}

export function useRaiseDebitNote() {
  const notify = useNotify()
  const qc = useQueryClient()
  const invalidate = useInvalidateEntries()
  return useMutation({
    mutationFn: async ({ companyId, purchaseId, body }: { companyId: number; purchaseId: number; body: DebitNoteInput }) =>
      (await api.post<EntryDetail>(API_ROUTES.debitNotes.raise(companyId, purchaseId), body)).data,
    onSuccess: (e) => {
      qc.setQueryData(entryKeys.one(e.company_id, e.type, e.id), e)
      notify.success('Debit note added', `Everyone will see it on the next purchase from ${e.party_name ?? 'this supplier'}`)
      void invalidate()
    },
  })
}

/** These open notes are settled on this bill. */
export function useAdjustDebitNotes() {
  const notify = useNotify()
  const qc = useQueryClient()
  const invalidate = useInvalidateEntries()
  return useMutation({
    mutationFn: async ({ entry, noteIds }: { entry: EntryDetail; noteIds: number[] }) =>
      (await api.post<EntryDetail>(API_ROUTES.debitNotes.adjust(entry.company_id, entry.id), { note_ids: noteIds })).data,
    onSuccess: (e) => {
      qc.setQueryData(entryKeys.one(e.company_id, e.type, e.id), e)
      notify.success('Debit note settled', `On ${e.ref_no}`)
      void invalidate()
    },
    onError: (err) => notify.error(err, 'Could not settle the debit note'),
  })
}
