import { useMemo, useState } from 'react'
import type { CompanyPermission } from '../types/auth'
import { useAccess } from './useAccess'

/**
 * For reports that work on one company at a time: the companies in view where the person has
 * `permission`, and which one is picked (the header's company when it is one of them).
 */
export function useReportCompany(permission: CompanyPermission) {
  const { scope, can, active } = useAccess()
  const companies = useMemo(() => scope.filter((c) => can(permission, c.id)), [scope, can, permission])
  const [picked, setPicked] = useState<number>()
  const fallback = companies.find((c) => c.id === active)?.id ?? companies[0]?.id
  const id = picked !== undefined && companies.some((c) => c.id === picked) ? picked : fallback
  return { companies, company: companies.find((c) => c.id === id), setCompany: setPicked }
}
