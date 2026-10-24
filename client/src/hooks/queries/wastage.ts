import { keepPreviousData, useMutation, useQueries, useQuery } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { EntryDetail } from '../../types/entries'
import type { Allowance, DebitNoteInput, PendingDebitNote, StockCheck, WastageMonth } from '../../types/reports'
import { useNotify } from '../useNotify'
import { useInvalidateEntries } from './entries'

type Range = [string, string]

export function useWastageMonths(companyId: number | undefined, [from, to]: Range) {
  return useQuery({
    queryKey: ['wastage', companyId, 'months', from, to],
    queryFn: async () => (await api.get<WastageMonth[]>(API_ROUTES.wastage.months(companyId!), { params: { date_from: from, date_to: to, bucket: 'month' } })).data,
    enabled: !!companyId,
    placeholderData: keepPreviousData,
  })
}

export function useAllowances(companyId: number | undefined) {
  return useQuery({
    queryKey: ['wastage', companyId, 'allowances'],
    queryFn: async () => (await api.get<Allowance[]>(API_ROUTES.wastage.allowances(companyId!))).data,
    enabled: !!companyId,
  })
}

/** Runs over the hard limit without a debit note, for each company the person may fix. */
export function usePendingNotes(companyIds: number[]) {
  return useQueries({
    queries: companyIds.map((id) => ({
      queryKey: ['debit-notes', id],
      queryFn: async () => (await api.get<PendingDebitNote[]>(API_ROUTES.wastage.pendingNotes(id))).data,
    })),
    combine: (results) => ({
      byCompany: new Map(companyIds.map((id, i) => [id, results[i]?.data ?? []])),
      total: results.reduce((s, r) => s + (r.data?.length ?? 0), 0),
      isLoading: results.some((r) => r.isLoading),
    }),
  })
}

export function useStockChecks(companyId: number | undefined) {
  return useQuery({
    queryKey: ['stock-checks', companyId],
    queryFn: async () => (await api.get<StockCheck[]>(API_ROUTES.wastage.stockChecks(companyId!))).data,
    enabled: !!companyId,
  })
}

export function useDeclareAllowance() {
  const notify = useNotify()
  const invalidate = useInvalidateEntries()
  return useMutation({
    mutationFn: async ({ companyId, body }: { companyId: number; body: { month: string; pct: number; note: string } }) => {
      await api.put(API_ROUTES.wastage.allowances(companyId), body)
    },
    onSuccess: () => {
      notify.success('Wastage allowance saved')
      return invalidate()
    },
  })
}

export function useAddDebitNote() {
  const notify = useNotify()
  const invalidate = useInvalidateEntries()
  return useMutation({
    mutationFn: async ({ companyId, productionId, body }: { companyId: number; productionId: number; body: DebitNoteInput }) =>
      (await api.post<EntryDetail>(API_ROUTES.wastage.debitNote(companyId, productionId), body)).data,
    onSuccess: (e) => {
      notify.success('Debit note recorded', `${e.ref_no} can now be approved`)
      return invalidate()
    },
  })
}

export function useRecordStockCheck() {
  const notify = useNotify()
  const invalidate = useInvalidateEntries()
  return useMutation({
    mutationFn: async ({ companyId, body }: { companyId: number; body: { counted_on: string; note: string; lines: { section: string; item: string; counted_qty: number }[] } }) => {
      await api.post(API_ROUTES.wastage.stockChecks(companyId), body)
    },
    onSuccess: () => {
      notify.success('Stock check saved', 'The book stock now matches your count')
      return invalidate()
    },
  })
}
