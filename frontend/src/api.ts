import type {
  Account,
  AccountConfig,
  Cashflow,
  Category,
  CategoryConfig,
  BudgetMonth,
  ImportPreviewRow,
  Recurring,
  RecurringBody,
  Report,
  Suggestion,
  Txn,
  TxnBody,
  TxnPage,
} from './types'

export class ApiError extends Error {}

async function request<T>(method: string, url: string, body?: unknown): Promise<T> {
  const isForm = body instanceof FormData
  const res = await fetch(`/api${url}`, {
    method,
    headers: body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : undefined,
    body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
  })
  if (!res.ok) {
    let message = res.statusText || `Request failed (${res.status})`
    try {
      const data = await res.json()
      const detail = data?.detail
      if (typeof detail === 'string') message = detail
      else if (Array.isArray(detail) && detail[0]?.msg) message = detail[0].msg
    } catch {
      // keep the status text
    }
    throw new ApiError(message)
  }
  return res.status === 204 ? (undefined as T) : ((await res.json()) as T)
}

const get = <T>(url: string) => request<T>('GET', url)
const post = <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {})
const put = <T>(url: string, body: unknown) => request<T>('PUT', url, body)
const del = <T = void>(url: string) => request<T>('DELETE', url)

function qs(params: Record<string, string | number | null | undefined>): string {
  const sp = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== null && v !== undefined && v !== '') sp.set(k, String(v))
  const s = sp.toString()
  return s ? `?${s}` : ''
}

export interface CategoryBody {
  name: string
  parent_id: number | null
  kind: string
  budget: string
  description: string
  sort_order: number
  is_active: boolean
}

export interface AccountBody {
  name: string
  kind: string
  opening_balance: string
  opening_date: string | null
  is_active: boolean
}

export const api = {
  categories: () => get<Category[]>('/categories'),
  createCategory: (b: Partial<CategoryBody> & { name: string }) => post<{ id: number }>('/categories', b),
  updateCategory: (id: number, b: CategoryBody) => put<{ id: number }>(`/categories/${id}`, b),
  deleteCategory: (id: number, moveTo: number | null) =>
    del(`/categories/${id}${qs({ move_to_id: moveTo })}`),

  accounts: (params: Record<string, string | number | null | undefined> = {}) =>
    get<Account[]>(`/accounts${qs(params)}`),
  createAccount: (b: AccountBody) => post<Account>('/accounts', b),
  updateAccount: (id: number, b: AccountBody) => put<Account>(`/accounts/${id}`, b),
  deleteAccount: (id: number) => del(`/accounts/${id}`),

  transactions: (filters: Record<string, string | number | null | undefined>) =>
    get<TxnPage>(`/transactions${qs(filters)}`),
  transaction: (id: number) => get<Txn>(`/transactions/${id}`),
  recentTransactions: () => get<Txn[]>('/transactions/recent'),
  descriptions: () => get<string[]>('/transactions/descriptions'),
  createTransaction: (b: TxnBody) => post<Txn>('/transactions', b),
  updateTransaction: (id: number, b: TxnBody) => put<Txn>(`/transactions/${id}`, b),
  deleteTransaction: (id: number) => del(`/transactions/${id}`),
  bulkCategory: (ids: number[], categoryId: number) =>
    post<{ moved: number }>('/transactions/bulk-category', { ids, category_id: categoryId }),
  suggest: (q: string) => get<Suggestion | null>(`/suggest${qs({ q })}`),

  recurring: (params: Record<string, string | number | null | undefined> = {}) =>
    get<Recurring[]>(`/recurring${qs(params)}`),
  createRecurring: (b: RecurringBody) => post<{ id: number }>('/recurring', b),
  updateRecurring: (id: number, b: RecurringBody) => put<{ id: number }>(`/recurring/${id}`, b),
  deleteRecurring: (id: number) => del(`/recurring/${id}`),

  importPreview: (form: FormData) => post<ImportPreviewRow[]>('/import/preview', form),
  importCommit: (accountId: number | null, rows: Omit<ImportPreviewRow, 'duplicate'>[]) =>
    post<{ imported: number }>('/import/commit', { account_id: accountId, rows }),

  budget: (month: string) => get<BudgetMonth>(`/budget${qs({ month })}`),
  setBudget: (month: string, categoryId: number, amount: string | null) =>
    put<{ ok: boolean }>(`/budget/${month}/${categoryId}`, { amount }),
  copyPreviousBudget: (month: string) => post<{ changed: number }>(`/budget/${month}/copy-previous`),
  generateBudget: (month: string, values: Record<number, number>) =>
    post<{ ok: boolean }>(`/budget/${month}/generate`, { values }),

  report: (month: number | null) => get<Report>(`/reports${qs({ month })}`),
  cashflow: (accountId: number | null) => get<Cashflow>(`/cashflow${qs({ account_id: accountId })}`),
  setThresholds: (low: string, warn: string) =>
    put<{ low_balance_cents: number; warn_balance_cents: number }>('/settings/thresholds', { low, warn }),
  categoryConfig: () => get<CategoryConfig>('/settings/category-config'),
  setLevels: (levels: string[]) => put<{ levels: string[] }>('/settings/category-config', { levels }),
  accountConfig: () => get<AccountConfig>('/settings/account-config'),
}
