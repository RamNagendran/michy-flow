import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { StockCheck, WastageMonth, WastageMonthDetail, WastageQueue } from '../../types/reports'
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

/** One month with its stock spread, history and the buttons this person may use. */
export function useWastageMonth(companyId: number | undefined, month: string | null) {
  return useQuery({
    queryKey: ['wastage', companyId, 'month', month],
    queryFn: async () => (await api.get<WastageMonthDetail>(API_ROUTES.wastage.month(companyId!, month!))).data,
    enabled: !!companyId && !!month,
  })
}

/** Months waiting on this person, per company: the Super Admin approves, the Manager answers. */
export function useWastageQueue(enabled: boolean) {
  return useQuery({
    queryKey: ['wastage-queue'],
    queryFn: async () => (await api.get<WastageQueue[]>(API_ROUTES.wastage.queue)).data,
    enabled,
    staleTime: 30_000,
  })
}

export function useStockChecks(companyId: number | undefined) {
  return useQuery({
    queryKey: ['stock-checks', companyId],
    queryFn: async () => (await api.get<StockCheck[]>(API_ROUTES.wastage.stockChecks(companyId!))).data,
    enabled: !!companyId,
  })
}

/** After any wastage step: the month, the month list, the queue and (after approval) the stock. */
function useInvalidateWastage() {
  const qc = useQueryClient()
  return (companyId: number) =>
    Promise.all([['wastage', companyId], ['wastage-queue'], ['stock', companyId]].map((queryKey) => qc.invalidateQueries({ queryKey })))
}

const stepDone: Record<'escalate' | 'resend' | 'comment', [string, string?]> = {
  escalate: ['Sent to the Manager', 'The Manager is told to reply.'],
  resend: ['Sent back to the Super Admin', 'Your reply is with the month.'],
  comment: ['Comment added'],
}

export function useWastageStep() {
  const notify = useNotify()
  const invalidate = useInvalidateWastage()
  return useMutation({
    mutationFn: async ({ companyId, month, action, comment }: { companyId: number; month: string; action: keyof typeof stepDone; comment: string }) =>
      (await api.post<WastageMonthDetail>(API_ROUTES.wastage.action(companyId, month, action), { comment })).data,
    onSuccess: (_, { companyId, action }) => {
      const [title, text] = stepDone[action]
      notify.success(title, text)
      void invalidate(companyId)
    },
  })
}

export function useChangeWastage() {
  const notify = useNotify()
  const invalidate = useInvalidateWastage()
  return useMutation({
    mutationFn: async ({ companyId, month, body }: { companyId: number; month: string; body: { wastage_kg: number; comment: string } }) =>
      (await api.put<WastageMonthDetail>(API_ROUTES.wastage.month(companyId, month), body)).data,
    onSuccess: (_, { companyId }) => {
      notify.success('Wastage changed', 'Check the stock changes, then approve the month.')
      void invalidate(companyId)
    },
  })
}

export function useApproveWastage() {
  const notify = useNotify()
  const invalidate = useInvalidateWastage()
  return useMutation({
    mutationFn: async ({ companyId, months, comment }: { companyId: number; months: { month: string; wastage_kg: number }[]; comment: string }) =>
      (await api.post<WastageMonth[]>(API_ROUTES.wastage.approve(companyId), { months, comment })).data,
    onSuccess: (done, { companyId }) => {
      notify.success(done.length === 1 ? 'Month approved' : `${done.length} months approved`, 'Production for these months is now locked.')
      void invalidate(companyId)
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
      // Refresh lists in the background: the save is done, so the form can close now.
      void invalidate()
    },
  })
}
