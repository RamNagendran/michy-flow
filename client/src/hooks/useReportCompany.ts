import type { CompanyPermission } from '../types/auth'
import { useAccess } from './useAccess'

/** The header's company, when the person has `permission` there. Reports never pick their own. */
export function useReportCompany(permission: CompanyPermission) {
  const { scope, can } = useAccess()
  return { company: scope.find((c) => can(permission, c.id)) }
}
