import type { Column } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react'
import ContentLoader from 'react-content-loader'

/** Clickable column header for a TanStack Table column. */
export function SortHeader<T>({ column, label }: { column: Column<T, unknown>; label: string }) {
  const sorted = column.getIsSorted()
  return (
    <button type="button" className="sort-header" onClick={column.getToggleSortingHandler()}>
      <span>{label}</span>
      {sorted === 'asc' ? (
        <ArrowUp size={14} />
      ) : sorted === 'desc' ? (
        <ArrowDown size={14} />
      ) : (
        <ArrowUpDown size={14} className="sort-idle" />
      )}
    </button>
  )
}

/** A single shimmer bar for skeleton rows (react-content-loader). */
export function Bar({ w, h = 12 }: { w: number; h?: number }) {
  return (
    <ContentLoader
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      backgroundColor="var(--line)"
      foregroundColor="var(--bg)"
    >
      <rect x="0" y="0" rx="4" ry="4" width={w} height={h} />
    </ContentLoader>
  )
}
