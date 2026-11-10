import { useMemo } from 'react'
import { useAppDispatch, useAppSelector } from '../statemanager/hooks'
import { activeCompanySet, type CompanySelection } from '../statemanager/slices/uiSlice'
import type { AuthUser, Company, CompanyAccess, CompanyPermission, SystemPermission } from '../types/auth'
import { STOCK_READERS } from '../utils/permissions'
import { useAuth } from './useAuth'

export interface Access {
  /** Every company this person can open, as sent by the server. */
  companies: CompanyAccess[]
  /** The company picked in the header (the first one until they pick). null = no companies. */
  active: CompanySelection | null
  activeAccess: CompanyAccess | undefined
  /** The companies the current screen shows: only the active one (empty with no companies). */
  scope: Company[]
  isGlobal: boolean
  /** In a given company, or (without an id) in any company currently in scope. */
  can: (permission: CompanyPermission, companyId?: number) => boolean
  /** In any company at all, whatever is selected. Used for menus and route guards. */
  canAnywhere: (...permissions: readonly CompanyPermission[]) => boolean
  canSystem: (permission: SystemPermission) => boolean
  /** May read this company's stock figures (see STOCK_READERS). */
  canReadStock: (companyId: number) => boolean
  /** The header's company, when the person holds `permission` there (empty otherwise). Entry
   * forms use it, so they never ask for a company of their own. */
  companiesWith: (permission: CompanyPermission) => Company[]
  accessFor: (companyId: number) => CompanyAccess | undefined
}

/** Pure, so it can be reasoned about (and tested) apart from React. */
export function resolveAccess(user: AuthUser | null, selected: CompanySelection | null): Access {
  const companies = user?.companies ?? []
  // Hash maps so every permission check is O(1), however many companies there are.
  const byId = new Map(companies.map((c) => [c.company.id, c]))
  const permsById = new Map(companies.map((c) => [c.company.id, new Set(c.permissions)]))
  const system = new Set(user?.system_permissions ?? [])

  // Always exactly one company: overall figures across companies are never shown. A saved
  // choice that is no longer valid (or the old 'all') falls back to the first company.
  const active: CompanySelection | null = typeof selected === 'number' && byId.has(selected) ? selected : (companies[0]?.company.id ?? null)
  const inScope = active === null ? [] : [byId.get(active)!]

  return {
    companies,
    active,
    activeAccess: active === null ? undefined : byId.get(active),
    scope: inScope.map((c) => c.company),
    isGlobal: !!user?.global_role,
    can: (permission, companyId) =>
      companyId !== undefined
        ? !!permsById.get(companyId)?.has(permission)
        : inScope.some((c) => permsById.get(c.company.id)!.has(permission)),
    canAnywhere: (...permissions) => companies.some((c) => permissions.some((p) => permsById.get(c.company.id)!.has(p))),
    canSystem: (permission) => system.has(permission),
    canReadStock: (companyId) => STOCK_READERS.some((p) => !!permsById.get(companyId)?.has(p)),
    companiesWith: (permission) => inScope.filter((c) => permsById.get(c.company.id)!.has(permission)).map((c) => c.company),
    accessFor: (companyId) => byId.get(companyId),
  }
}

export function useAccess() {
  const { user } = useAuth()
  const selected = useAppSelector((s) => s.ui.activeCompany)
  const dispatch = useAppDispatch()
  const access = useMemo(() => resolveAccess(user, selected), [user, selected])
  return { ...access, setActive: (c: CompanySelection | null) => dispatch(activeCompanySet(c)) }
}
