type EntryKind = 'purchase' | 'sale' | 'production'
const entryCollection = (companyId: number, type: EntryKind) =>
  `/companies/${companyId}/${type === 'purchase' ? 'purchases' : type === 'sale' ? 'sales' : 'production'}`

/** Every backend path, grouped by domain. Never hard-code a path in a hook or page. */
export const API_ROUTES = {
  health: '/health',
  auth: {
    signup: '/auth/signup',
    login: '/auth/login',
    refresh: '/auth/refresh',
    me: '/auth/me',
    changePassword: '/auth/change-password',
  },
  companies: {
    list: '/companies',
    one: (id: number) => `/companies/${id}`,
    auditLogs: (id: number) => `/companies/${id}/audit-logs`,
    config: (id: number) => `/companies/${id}/config`,
    crew: (id: number) => `/companies/${id}/crew`,
  },
  users: {
    list: '/users',
    one: (id: number) => `/users/${id}`,
    access: (id: number) => `/users/${id}/access`,
    resetPassword: (id: number) => `/users/${id}/reset-password`,
  },
  auditLogs: '/audit-logs',
  entries: {
    list: '/entries',
    create: entryCollection,
    update: (companyId: number, type: EntryKind, id: number) => `${entryCollection(companyId, type)}/${id}`,
    one: (companyId: number, type: string, id: number) => `/companies/${companyId}/entries/${type}/${id}`,
    action: (companyId: number, type: string, id: number, action: string) => `/companies/${companyId}/entries/${type}/${id}/actions/${action}`,
    comments: (companyId: number, type: string, id: number) => `/companies/${companyId}/entries/${type}/${id}/comments`,
    escalate: (companyId: number, type: string, id: number) => `/companies/${companyId}/entries/${type}/${id}/escalate`,
    statusSummary: '/entries/status-summary',
  },
  reports: {
    trends: (companyId: number) => `/companies/${companyId}/trends`,
    oilKpi: (companyId: number) => `/companies/${companyId}/oil-kpi`,
    prices: (companyId: number) => `/companies/${companyId}/prices`,
    production: (companyId: number) => `/companies/${companyId}/production-report`,
    tradeAnalysis: (companyId: number) => `/companies/${companyId}/trade-analysis`,
  },
  wastage: {
    months: (companyId: number) => `/companies/${companyId}/wastage`,
    allowances: (companyId: number) => `/companies/${companyId}/wastage/allowances`,
    stockChecks: (companyId: number) => `/companies/${companyId}/stock-checks`,
  },
  debitNotes: {
    list: (companyId: number) => `/companies/${companyId}/debit-notes`,
    raise: (companyId: number, purchaseId: number) => `/companies/${companyId}/purchases/${purchaseId}/debit-notes`,
    adjust: (companyId: number, purchaseId: number) => `/companies/${companyId}/purchases/${purchaseId}/debit-notes/adjust`,
  },
  stock: (companyId: number) => `/companies/${companyId}/stock`,
  summary: (companyId: number) => `/companies/${companyId}/summary`,
  documents: {
    upload: (companyId: number) => `/companies/${companyId}/documents`,
    file: (companyId: number, id: number) => `/companies/${companyId}/documents/${id}/file`,
  },
  realtime: '/ws',
  parties: {
    list: (companyId: number) => `/companies/${companyId}/parties`,
    one: (companyId: number, id: number) => `/companies/${companyId}/parties/${id}`,
  },
} as const

/** Auth calls where a 401 means "wrong credentials", not "access token expired". */
export const NO_REFRESH_ROUTES: readonly string[] = [API_ROUTES.auth.login, API_ROUTES.auth.signup, API_ROUTES.auth.refresh]
