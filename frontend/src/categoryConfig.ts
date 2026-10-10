import type { CategoryConfig } from './types'

export const DEFAULT_LEVELS = ['Section', 'Category', 'Sub-category', 'Sub-sub-category']

export const levelsOf = (config: CategoryConfig | undefined): string[] => config?.levels ?? DEFAULT_LEVELS

export const typeLabel = (config: CategoryConfig | undefined, kind: string): string =>
  config?.types.find((t) => t.key === kind)?.label ?? kind

export const isIncomeKind = (config: CategoryConfig | undefined, kind: string): boolean =>
  config?.types.find((t) => t.key === kind)?.direction === 'in'
