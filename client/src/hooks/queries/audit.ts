import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { api } from '../../services/api'
import { API_ROUTES } from '../../utils/apiRoutes'
import type { AuditLog, Paginated } from '../../types/auth'

export type AuditArea = 'entries' | 'wastage' | 'parties' | 'documents' | 'people' | 'sign_in' | 'companies' | 'items'

export interface AuditQuery {
  page: number
  page_size: number
  area?: AuditArea
  actor_id?: number
  company_id?: number
  date_from?: string
  date_to?: string
  q?: string
}

/** The whole organisation's audit trail (Super Admin only). User changes refresh it too. */
export function useAuditLogs(query: AuditQuery) {
  return useQuery({
    queryKey: ['audit-logs', query],
    queryFn: async () => (await api.get<Paginated<AuditLog>>(API_ROUTES.auditLogs, { params: query })).data,
    placeholderData: keepPreviousData,
  })
}
