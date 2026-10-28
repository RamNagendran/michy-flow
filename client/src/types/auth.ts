import type { CompanyCategory } from '../data/catalog'

// Mirrors server/app/schemas/user.py, server/app/schemas/company.py and server/app/auth/permissions.py

export type GlobalRole = 'super_admin' | 'ceo'
export type CompanyRole = 'manager' | 'finance' | 'operator'
/** 'shift' = works in the plant on production shifts; enters nothing, only listed in shift crews. */
export type Duty = 'purchase' | 'sales' | 'production' | 'shift'

export type SystemPermission = 'manage_companies' | 'manage_users' | 'manage_config' | 'view_audit'

export type CompanyPermission =
  | 'view'
  | 'view_stock'
  | 'view_all_entries'
  | 'comment_entry'
  | 'enter_purchase'
  | 'enter_sales'
  | 'enter_production'
  | 'edit_entry'
  | 'reject_entry'
  | 'approve_entry'
  | 'verify_entry'
  | 'manage_parties'
  | 'adjust_wastage'
  | 'manage_grades'
  | 'view_finance'
  | 'view_oil_kpi'
  | 'view_audit'

export interface Account {
  id: number
  name: string
}

export interface CompanyBrief {
  id: number
  code: string
  name: string
}

export interface Company extends CompanyBrief {
  city: string
  /** What the plant does: decides its raw material and products (data/catalog.ts). */
  category: CompanyCategory
  /** Inventory configuration: what this company processes and makes (set by the Super Admin). */
  input_items: string[]
  output_items: string[]
  /** kg per litre of oil. */
  oil_density: number
  /** Months between the Manager's physical stock checks. */
  stock_check_months: 1 | 3
  is_active: boolean
}

export interface CompanyConfig {
  input_items: string[]
  output_items: string[]
  oil_density: number
  stock_check_months: 1 | 3
}

/** What the signed-in person may do in one company, resolved by the server. */
export interface CompanyAccess {
  company: Company
  /** null when access comes from a global role (Super Admin / CEO). */
  role: CompanyRole | null
  duties: Duty[]
  permissions: CompanyPermission[]
}

interface UserBase {
  id: number
  email: string
  full_name: string
  global_role: GlobalRole | null
  is_active: boolean
  must_change_password: boolean
  last_login_at: string | null
  created_at: string
}

/** The signed-in person. */
export interface AuthUser extends UserBase {
  account_id: number
  account: Account
  system_permissions: SystemPermission[]
  companies: CompanyAccess[]
}

export interface Membership {
  company: CompanyBrief
  role: CompanyRole
  duties: Duty[]
}

/** A person as listed in Settings → Users. */
export interface ManagedUser extends UserBase {
  memberships: Membership[]
}

export interface MembershipInput {
  company_id: number
  role: CompanyRole
  duties: Duty[]
}

export interface AccessInput {
  global_role: GlobalRole | null
  memberships: MembershipInput[]
}

export interface UserCreateRequest extends AccessInput {
  email: string
  full_name: string
}

export interface UserUpdateRequest {
  full_name?: string
  is_active?: boolean
}

export interface UserWithPassword {
  user: ManagedUser
  temporary_password: string
}

export interface CompanyInput {
  category: CompanyCategory
  code: string
  name: string
  city: string
  is_active?: boolean
}

export interface AuditLog {
  id: number
  actor_id: number | null
  actor_name: string | null
  company_id: number | null
  action: string
  entity_type: string
  entity_id: number | null
  details: Record<string, unknown>
  ip_address: string | null
  created_at: string
}

export interface Paginated<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export interface TokenResponse {
  access_token: string
  refresh_token: string
  token_type: 'bearer'
  expires_in: number
  user: AuthUser
}

export interface LoginRequest {
  email: string
  password: string
}

export interface SignupRequest {
  account_name: string
  full_name: string
  email: string
  password: string
}

export interface ChangePasswordRequest {
  current_password: string
  new_password: string
}

/** The bits of a company most screens need. */
export type CompanyRef = Pick<Company, 'id' | 'code' | 'name' | 'city' | 'category' | 'input_items' | 'output_items' | 'oil_density'>
