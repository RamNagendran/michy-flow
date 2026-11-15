import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { Machine, MachineInput, Operator, OperatorInput } from '../../types/entries'
import { useNotify } from '../useNotify'

/** The company's operators. The in-charge gets the active ones; the Manager gets all. */
export function useOperators(companyId: number | undefined) {
  return useQuery({
    queryKey: ['operators', companyId],
    queryFn: async () => (await api.get<Operator[]>(API_ROUTES.plant.operators(companyId!))).data,
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  })
}

/** The company's machines. The in-charge gets the active ones; the Manager gets all. */
export function useMachines(companyId: number | undefined) {
  return useQuery({
    queryKey: ['machines', companyId],
    queryFn: async () => (await api.get<Machine[]>(API_ROUTES.plant.machines(companyId!))).data,
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  })
}

export function useSaveOperator(companyId: number) {
  const notify = useNotify()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id?: number; body: OperatorInput }) =>
      (id ? await api.put<Operator>(API_ROUTES.plant.operator(companyId, id), body) : await api.post<Operator>(API_ROUTES.plant.operators(companyId), body)).data,
    onSuccess: (o, { id }) => {
      notify.success(id ? 'Saved' : 'Operator added', o.name)
      // Refresh the list in the background: the save is done, so the form can close now.
      void qc.invalidateQueries({ queryKey: ['operators', companyId] })
    },
  })
}

export function useSaveMachine(companyId: number) {
  const notify = useNotify()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id?: number; body: MachineInput }) =>
      (id ? await api.put<Machine>(API_ROUTES.plant.machine(companyId, id), body) : await api.post<Machine>(API_ROUTES.plant.machines(companyId), body)).data,
    onSuccess: (m, { id }) => {
      notify.success(id ? 'Saved' : 'Machine added', `${m.code} · ${m.name}`)
      // Refresh the list in the background: the save is done, so the form can close now.
      void qc.invalidateQueries({ queryKey: ['machines', companyId] })
    },
  })
}
