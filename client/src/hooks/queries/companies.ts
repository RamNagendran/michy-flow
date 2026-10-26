import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { Company, CompanyConfig, CompanyInput } from '../../types/auth'
import type { CrewMember } from '../../types/entries'
import { authKeys } from './auth'
import { useNotify } from '../useNotify'

export const companyKeys = {
  all: ['companies'] as const,
  list: () => [...companyKeys.all, 'list'] as const,
}

/** Companies the signed-in person can open (the Super Admin also gets deactivated ones). */
export function useCompanies() {
  return useQuery({
    queryKey: companyKeys.list(),
    queryFn: async () => (await api.get<Company[]>(API_ROUTES.companies.list)).data,
  })
}

/** Company changes alter what /auth/me returns, so both are refreshed. */
function useInvalidateCompanies() {
  const qc = useQueryClient()
  return () => Promise.all([qc.invalidateQueries({ queryKey: companyKeys.all }), qc.invalidateQueries({ queryKey: authKeys.me() })])
}

export function useSaveCompany() {
  const notify = useNotify()
  const invalidate = useInvalidateCompanies()
  return useMutation({
    mutationFn: async ({ id, body }: { id?: number; body: Partial<CompanyInput> }) =>
      (id ? await api.patch<Company>(API_ROUTES.companies.one(id), body) : await api.post<Company>(API_ROUTES.companies.list, body)).data,
    onSuccess: (company, { id }) => {
      notify.success(id ? 'Company updated' : 'Company added', company.name)
      // Refresh lists in the background: the save is done, so the form can close now.
      void invalidate()
    },
  })
}

/** The Super Admin's inventory configuration for one company. */
export function useConfigureCompany() {
  const notify = useNotify()
  const invalidate = useInvalidateCompanies()
  const qc = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, body }: { id: number; body: CompanyConfig }) => (await api.put<Company>(API_ROUTES.companies.config(id), body)).data,
    onSuccess: (company) => {
      notify.success('Stock settings saved', company.name)
      // Show the saved company at once; refresh everything that depends on it in the background.
      qc.setQueryData<Company[]>(companyKeys.list(), (list) => list?.map((c) => (c.id === company.id ? company : c)))
      void invalidate()
      void qc.invalidateQueries({ queryKey: ['stock', company.id] })
    },
  })
}

/** Operators a production in-charge can put on a shift. */
export function useCrew(companyId: number | undefined) {
  return useQuery({
    queryKey: ['crew', companyId],
    queryFn: async () => (await api.get<CrewMember[]>(API_ROUTES.companies.crew(companyId!))).data,
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  })
}
