import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { Party, PartyInput, PartyKind } from '../../types/entries'
import { useNotify } from '../useNotify'

export function useParties(companyId: number | undefined, kind?: PartyKind) {
  return useQuery({
    queryKey: ['parties', companyId, kind ?? 'all'],
    queryFn: async () => (await api.get<Party[]>(API_ROUTES.parties.list(companyId!), { params: { kind } })).data,
    enabled: !!companyId,
    staleTime: 60_000,
  })
}

export function useSaveParty(companyId: number) {
  const notify = useNotify()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id?: number; body: PartyInput }) =>
      (id ? await api.put<Party>(API_ROUTES.parties.one(companyId, id), body) : await api.post<Party>(API_ROUTES.parties.list(companyId), body)).data,
    onSuccess: (p, { id }) => {
      notify.success(id ? 'Saved' : `${p.kind === 'supplier' ? 'Supplier' : 'Buyer'} added`, p.name)
      return qc.invalidateQueries({ queryKey: ['parties', companyId] })
    },
  })
}
