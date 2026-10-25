import type { CompanyPermission, CompanyRole, Duty, GlobalRole } from '../types/auth'

/**
 * The server decides access: /auth/me sends each person's resolved permissions per company
 * (see server/app/auth/permissions.py). The client only reads them, through useAccess().
 *
 * The tables below are for *display* (Settings → Roles), and for naming which permission
 * unlocks which screen. Keep ROLE_MATRIX in step with the server file when roles change.
 */

/**
 * Screens that open for anyone holding at least one of these permissions in some company.
 * The sidebar, route guards and in-page links all read this table, so a screen is either
 * fully available or not shown at all. The API checks the same permissions on every call.
 */
export const SCREEN_ACCESS = {
  /** Company-wide dashboard. Without it, the home screen is the operator's task list. */
  dashboard: ['view_all_entries'],
  purchases: ['view_all_entries', 'enter_purchase'],
  production: ['view_all_entries', 'enter_production'],
  sales: ['view_all_entries', 'enter_sales'],
  review: ['view_all_entries'],
  parties: ['view_all_entries', 'manage_parties'],
  stock: ['view_stock'],
  finance: ['view_finance'],
  reports: ['view_all_entries'],
  pricing: ['view_finance'],
  wastage: ['view_all_entries'],
  records: ['view_finance', 'edit_entry', 'verify_entry'],
  enterAny: ['enter_purchase', 'enter_sales', 'enter_production'],
} as const satisfies Record<string, readonly CompanyPermission[]>

/**
 * Who may read a company's stock figures. Sale and production forms need them to check what is
 * available, so those operators may read them even without the stock screens. Matches the
 * server's GET /companies/{id}/stock.
 */
export const STOCK_READERS = ['view_stock', 'enter_sales', 'enter_production'] as const satisfies readonly CompanyPermission[]

export const DUTY_PERMISSION: Record<Duty, CompanyPermission> = {
  purchase: 'enter_purchase',
  sales: 'enter_sales',
  production: 'enter_production',
}

export const globalRoleLabel: Record<GlobalRole, string> = { super_admin: 'Super Admin', ceo: 'CEO' }

export const companyRoleLabel: Record<CompanyRole, string> = {
  manager: 'Manager',
  admin: 'Admin',
  finance: 'Finance',
  operator: 'Operator',
}

export const dutyLabel: Record<Duty, string> = { purchase: 'Purchase', sales: 'Sales', production: 'Production' }

export const roleColor: Record<GlobalRole | CompanyRole, string> = {
  super_admin: '#D82E54',
  ceo: '#191919',
  manager: '#7A5AF8',
  admin: '#B8213F',
  finance: '#0E9384',
  operator: '#2F6FEB',
}

export const roleDescription: Record<GlobalRole | CompanyRole, string> = {
  super_admin: 'Runs the whole system: companies, users, product lists and conversion factors.',
  ceo: 'Sees every company, read-only. Picks the company on the home screen.',
  manager: 'Runs one company: enters and edits data, manages suppliers and buyers.',
  admin: 'Checks and approves entries, manages wastage and grade A/B/C stock.',
  finance: 'Cross-verifies entries, comments on mismatches, approves or puts on hold.',
  operator: 'Enters purchase, sales or production data only, as ticked for them.',
}

export type MatrixColumn = GlobalRole | CompanyRole

export const MATRIX_COLUMNS: MatrixColumn[] = ['super_admin', 'ceo', 'manager', 'admin', 'finance', 'operator']

/** `true` = allowed, `'duty'` = only for the duties ticked for that operator. */
export const ROLE_MATRIX: [string, Partial<Record<MatrixColumn, true | 'duty'>>][] = [
  ['See company data', { super_admin: true, ceo: true, manager: true, admin: true, finance: true, operator: 'duty' }],
  ['See stock screens', { super_admin: true, ceo: true, manager: true, admin: true, finance: true }],
  ['See every company', { super_admin: true, ceo: true }],
  ["See everyone's entries (operators see only their own, of their duties)", { super_admin: true, ceo: true, manager: true, admin: true, finance: true }],
  ['Comment on entries and reply to queries', { super_admin: true, manager: true, admin: true, finance: true, operator: true }],
  ['Enter purchases, sales, production', { super_admin: true, manager: true, admin: true, operator: 'duty' }],
  ['Edit an entry', { super_admin: true, manager: true, admin: true }],
  ['Delete an entry', { super_admin: true, admin: true }],
  ['Approve operator entries', { super_admin: true, admin: true }],
  ['Verify, comment, approve or hold (finance)', { super_admin: true, finance: true }],
  ['Add and edit suppliers and buyers', { super_admin: true, manager: true, admin: true }],
  ['Adjust monthly wastage (max 1–2%)', { super_admin: true, admin: true }],
  ['Manage grade A / B / C stock', { super_admin: true, admin: true }],
  ['See finance and reports', { super_admin: true, ceo: true, manager: true, admin: true, finance: true }],
  ['See oil production KPI', { super_admin: true, ceo: true, manager: true }],
  ['See the audit log', { super_admin: true, admin: true }],
  ['Manage companies, users and product lists', { super_admin: true }],
]
