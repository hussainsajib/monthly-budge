import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: api.categories })
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: () => api.accounts() })
export const useCategoryConfig = () => useQuery({ queryKey: ['category-config'], queryFn: api.categoryConfig })
export const useAccountConfig = () => useQuery({ queryKey: ['account-config'], queryFn: api.accountConfig })

/** Server-sorted variant for the accounts table; pickers keep using the shared `useAccounts` entry. */
export const useSortedAccounts = (sort: string, dir: string) =>
  useQuery({ queryKey: ['accounts', 'sorted', sort, dir], queryFn: () => api.accounts({ sort, dir }) })

/** Server-sorted variant for the recurring table. */
export const useSortedRecurring = (sort: string, dir: string) =>
  useQuery({ queryKey: ['recurring', sort, dir], queryFn: () => api.recurring({ sort, dir }) })
