import { subtreeIds } from './categoryTree'
import type { Category, ImportPreviewRow } from './types'

export interface ImportFilters {
  year: string // "2026" or ""
  month: string // "2026-03" or ""
  from: string // ISO date or ""
  to: string
  text: string
  /** "" = any, "none" = unassigned, otherwise a category id (its sub-categories match too). */
  category: string
  direction: '' | 'in' | 'out'
  min: string // dollars, compared with the absolute amount
  max: string
}

export const NO_FILTERS: ImportFilters = {
  year: '',
  month: '',
  from: '',
  to: '',
  text: '',
  category: '',
  direction: '',
  min: '',
  max: '',
}

export function isFiltered(f: ImportFilters): boolean {
  return (Object.keys(NO_FILTERS) as (keyof ImportFilters)[]).some((k) => f[k] !== '')
}

/** Dollars typed by the user -> cents, or null when blank/invalid (an invalid bound is ignored, not an error). */
function dollarsToCents(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '')
  if (cleaned === '' || !/^\d*\.?\d+$|^\d+\.$/.test(cleaned)) return null
  return Math.round(parseFloat(cleaned) * 100)
}

export function makeRowMatcher(
  f: ImportFilters,
  categories: Category[],
): (row: Pick<ImportPreviewRow, 'date' | 'description' | 'amount_cents' | 'direction' | 'category_id'>) => boolean {
  const text = f.text.trim().toLowerCase()
  const min = dollarsToCents(f.min)
  const max = dollarsToCents(f.max)
  const categoryIds = f.category && f.category !== 'none' ? subtreeIds(categories, Number(f.category)) : null

  return (row) => {
    if (f.year && !row.date.startsWith(`${f.year}-`)) return false
    if (f.month && !row.date.startsWith(f.month)) return false
    if (f.from && row.date < f.from) return false
    if (f.to && row.date > f.to) return false
    if (text && !row.description.toLowerCase().includes(text)) return false
    if (f.direction && row.direction !== f.direction) return false
    if (min !== null && row.amount_cents < min) return false
    if (max !== null && row.amount_cents > max) return false
    if (f.category === 'none') return row.category_id === null
    if (categoryIds) return row.category_id !== null && categoryIds.has(row.category_id)
    return true
  }
}
