import { useQuery } from '@tanstack/react-query'
import { api } from './api'

export const useCategories = () => useQuery({ queryKey: ['categories'], queryFn: api.categories })
export const useAccounts = () => useQuery({ queryKey: ['accounts'], queryFn: api.accounts })
