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

/** 'shift' grants no permission; it only puts the person in the shift crew list. */
export const DUTY_PERMISSION: Partial<Record<Duty, CompanyPermission>> = {
  purchase: 'enter_purchase',
  sales: 'enter_sales',
  production: 'enter_production',
}

export const globalRoleLabel: Record<GlobalRole, string> = { super_admin: 'Super Admin', ceo: 'CEO' }

export const companyRoleLabel: Record<CompanyRole, string> = {
  manager: 'Manager',
  finance: 'Finance',
  operator: 'In-charge',
}

export const dutyLabel: Record<Duty, string> = { purchase: 'Purchase', sales: 'Sales', production: 'Production', shift: 'Shift worker' }

export const roleColor: Record<GlobalRole | CompanyRole, string> = {
  super_admin: '#D82E54',
  ceo: '#191919',
  manager: '#7A5AF8',
  finance: '#0E9384',
  operator: '#2F6FEB',
}

export const roleDescription: Record<GlobalRole | CompanyRole, string> = {
  super_admin: 'Manages everything: companies, users, item lists and oil factor.',
  ceo: 'Can see all companies. Cannot change anything.',
  manager: 'Runs one company. Checks every entry first: approves it, escalates it to the in-charge, or asks the Super Admin to change it. Handles suppliers, buyers and stock checks. Answers questions from the Super Admin on monthly wastage.',
  finance: 'Gives the final approval after the Manager, or escalates it back to the Manager.',
  operator: 'In-charge. Enters purchases, sales or production, as ticked for them. Sees their own entries and the stock. Shift workers are listed when production is entered.',
}

export type MatrixColumn = GlobalRole | CompanyRole

export const MATRIX_COLUMNS: MatrixColumn[] = ['super_admin', 'ceo', 'manager', 'finance', 'operator']

/** `true` = allowed, `'duty'` = only for the duties ticked for that operator. */
export const ROLE_MATRIX: [string, Partial<Record<MatrixColumn, true | 'duty'>>][] = [
  ['See company data', { super_admin: true, ceo: true, manager: true, finance: true, operator: 'duty' }],
  ['See stock', { super_admin: true, ceo: true, manager: true, finance: true, operator: true }],
  ['See every company', { super_admin: true, ceo: true }],
  ['See all entries (in-charges see only their own)', { super_admin: true, ceo: true, manager: true, finance: true }],
  ['Comment on entries', { super_admin: true, manager: true, finance: true, operator: true }],
  ['Enter purchases, sales, production', { super_admin: true, operator: 'duty' }],
  ['Approve first, or escalate to the in-charge', { super_admin: true, manager: true }],
  ['Ask the Super Admin to change an entry', { super_admin: true, manager: true }],
  ['Final approval, or escalate to the Manager', { super_admin: true, finance: true }],
  ['Change or reject an entry', { super_admin: true }],
  ['Add and edit suppliers and buyers', { super_admin: true, manager: true }],
  ['Count stock, and answer questions on monthly wastage', { super_admin: true, manager: true }],
  ['Approve, change or escalate monthly wastage', { super_admin: true }],
  ['Manage grade A / B / C stock', { super_admin: true, manager: true }],
  ['See finance and reports', { super_admin: true, ceo: true, manager: true, finance: true }],
  ['See oil production KPI', { super_admin: true, ceo: true, manager: true }],
  ['See the audit log', { super_admin: true, manager: true }],
  ['Manage companies, users and item lists', { super_admin: true }],
]
