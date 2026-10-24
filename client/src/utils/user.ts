import type { AuthUser, CompanyAccess, GlobalRole, CompanyRole } from '../types/auth'
import { companyRoleLabel, globalRoleLabel } from './permissions'

export const firstName = (user: Pick<AuthUser, 'full_name'> | null) => user?.full_name.trim().split(/\s+/)[0] ?? ''

export const initials = (user: Pick<AuthUser, 'full_name'> | null) =>
  (user?.full_name ?? '')
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

export const roleLabel = (role: GlobalRole | CompanyRole) =>
  role in globalRoleLabel ? globalRoleLabel[role as GlobalRole] : companyRoleLabel[role as CompanyRole]

/** "Super Admin", or "Operator" / "Admin" in the given company. */
export const accessRoleLabel = (user: AuthUser | null, access?: CompanyAccess) =>
  user?.global_role ? globalRoleLabel[user.global_role] : access?.role ? companyRoleLabel[access.role] : ''
