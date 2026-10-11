import { useQuery } from '@tanstack/react-query'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useRef, useState } from 'react'
import ReactPaginateImport from 'react-paginate'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Tooltip } from 'react-tooltip'
import { api } from '../api'
import { DEFAULT_LEVELS, isIncomeKind } from '../categoryConfig'
import { AccountSelect, CategoryFilter } from '../components/selects'
import { Bar, SortHeader } from '../components/table'
import TxnForm, { type TxnFormValues } from '../components/TxnForm'
import { Modal } from '../components/ui'
import { formatMoney, todayIso } from '../money'
import { useAccounts, useCategories, useCategoryConfig } from '../queries'
import { useRun } from '../toast'
import type { Txn } from '../types'

const FILTER_KEYS = ['q', 'start', 'end', 'category_id', 'account_id', 'range'] as const
type FilterKey = (typeof FILTER_KEYS)[number]

type RangeKey = 'all' | 'month' | 'days30' | 'ytd' | 'custom'
const RANGE_OPTIONS: Array<{ key: RangeKey; short: string; full: string }> = [
  { key: 'all', short: 'All', full: 'All time' },
  { key: 'month', short: 'Month', full: 'This month' },
  { key: 'days30', short: '30d', full: 'Last 30 days' },
  { key: 'ytd', short: 'YTD', full: 'Year to date' },
  { key: 'custom', short: 'Custom', full: 'Custom' },
]

const isoOf = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Start/end corners for the preset ranges (custom/all handled separately). */
function rangeDates(key: Exclude<RangeKey, 'all' | 'custom'>): { start: string; end: string } {
  const now = new Date()
  if (key === 'month') {
    return {
      start: isoOf(new Date(now.getFullYear(), now.getMonth(), 1)),
      end: isoOf(new Date(now.getFullYear(), now.getMonth() + 1, 0)),
    }
  }
  if (key === 'days30') {
    const s = new Date(now)
    s.setDate(s.getDate() - 29)
    return { start: isoOf(s), end: isoOf(now) }
  }
  return { start: isoOf(new Date(now.getFullYear(), 0, 1)), end: isoOf(now) }
}

// react-paginate is CJS; some bundlers hand back the module namespace ({ default: Component }) as the default import.
const ReactPaginate =
  (ReactPaginateImport as unknown as { default?: typeof ReactPaginateImport }).default ?? ReactPaginateImport

const blankForm = (date: string): TxnFormValues => ({
  date,
  description: '',
  category_id: null,
  account_id: null,
  amount: '',
  notes: '',
})

// Fixed column widths keep the table from reflowing as different rows are shown.
const COL_WIDTH: Record<string, string> = {
  date: '10%',
  account: '14%',
  amount: '11%',
}

function TableSkeleton({ levels }: { levels: string[] }) {
  const heads: Array<{ label: string; width?: string; cls?: string }> = [
    { label: 'Date', width: COL_WIDTH.date },
    { label: 'Description' },
    ...levels.map((l) => ({ label: l })),
    { label: 'Account', width: COL_WIDTH.account, cls: 'hide-sm' },
    { label: 'Amount', width: COL_WIDTH.amount, cls: 'num' },
  ]
  const barWidths = heads.map((_, i) => (i === 0 ? 90 : i === 1 ? 240 : 120))
  return (
    <table className="txn-table">
      <thead>
        <tr>
          {heads.map((c, i) => (
            <th key={i} className={c.cls ?? ''} style={c.width ? { width: c.width } : undefined}>
              {c.label}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 8 }).map((_, row) => (
          <tr key={row}>
            {heads.map((c, col) => (
              <td key={col} className={c.cls ?? ''}>
                <Bar w={barWidths[col]} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export default function TransactionsPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const run = useRun()
  const categories = useCategories()
  const config = useCategoryConfig().data
  const accounts = useAccounts()
  const descriptions = useQuery({ queryKey: ['transactions', 'descriptions'], queryFn: api.descriptions })
  const [initial, setInitial] = useState<TxnFormValues>(() => blankForm(todayIso()))
  const [adding, setAdding] = useState(false)
  const [advanced, setAdvanced] = useState(false)
  const [customRange, setCustomRange] = useState<{ start: string; end: string } | null>(null)
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }])

  const sort = sorting[0]?.id ?? 'date'
  const dir = sorting[0] && sorting[0].desc === false ? 'asc' : 'desc'

  const filters = Object.fromEntries([...FILTER_KEYS, 'page'].map((k) => [k, params.get(k) ?? '']))
  const rangeKey: RangeKey = filters.range === 'custom' || filters.range === 'month' || filters.range === 'days30' || filters.range === 'ytd' ? filters.range : 'all'
  const rangeDatesValue = rangeKey === 'custom' ? { start: filters.start, end: filters.end } : rangeKey === 'all' ? { start: '', end: '' } : rangeDates(rangeKey)
  const serverQuery = {
    q: filters.q,
    start: rangeDatesValue.start,
    end: rangeDatesValue.end,
    category_id: filters.category_id,
    account_id: filters.account_id,
    page: filters.page,
  }
  const list = useQuery({
    queryKey: ['transactions', 'list', serverQuery, sort, dir],
    queryFn: () => api.transactions({ ...serverQuery, sort, dir }),
  })

  const categoryById = new Map((categories.data ?? []).map((c) => [c.id, c]))
  const accountById = new Map((accounts.data ?? []).map((a) => [a.id, a]))

  // Filter edits live in the URL so a filtered view can be linked to (the Categories tab does this).
  const [draft, setDraft] = useState(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])))
  const setField = (k: FilterKey, v: string) => setDraft((d) => ({ ...d, [k]: v }))

  const writeParam = (k: FilterKey, v: string) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      if (v) next.set(k, v)
      else next.delete(k)
      next.delete('page') // a filter change starts back on page 1
      return next
    })

  // Main-page filters apply live; the advanced modal's Apply commits the rest.
  const applyField = (k: FilterKey, v: string) => {
    setField(k, v)
    writeParam(k, v)
  }
  const clearField = (k: FilterKey) => applyField(k, '')

  const applyRange = (key: RangeKey) => {
    setField('range', key === 'all' ? '' : key)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.delete('page')
      if (key === 'all') {
        next.delete('range')
        next.delete('start')
        next.delete('end')
      } else {
        next.set('range', key)
        if (key !== 'custom') {
          next.delete('start')
          next.delete('end')
        }
      }
      return next
    })
  }
  const applyRangeCustom = (values: { start: string; end: string }) => {
    setField('range', 'custom')
    setField('start', values.start)
    setField('end', values.end)
    setParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('range', 'custom')
      if (values.start) next.set('start', values.start)
      else next.delete('start')
      if (values.end) next.set('end', values.end)
      else next.delete('end')
      next.delete('page')
      return next
    })
    setCustomRange(null)
  }
  const searchTimer = useRef<number | undefined>(undefined)
  const onSearchChange = (v: string) => {
    setField('q', v)
    window.clearTimeout(searchTimer.current)
    searchTimer.current = window.setTimeout(() => writeParam('q', v), 300)
  }

  const applyFilters = () => {
    const next = new URLSearchParams()
    for (const k of FILTER_KEYS) if (draft[k]) next.set(k, draft[k])
    setParams(next)
  }
  const clearFilters = () => {
    setDraft(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])))
    setParams(new URLSearchParams())
  }
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params)
    next.set('page', String(page))
    setParams(next)
  }
  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting((prev) => (typeof updater === 'function' ? updater(prev) : updater))
    const next = new URLSearchParams(params)
    next.delete('page') // a new sort starts back on page 1
    setParams(next)
  }

  const items = list.data?.items ?? []
  const from = location.pathname + location.search

  const chips: { key: string; label: string; clear: () => void }[] = []
  if (filters.q) chips.push({ key: 'q', label: `Search: ${filters.q}`, clear: () => clearField('q') })
  if (rangeKey !== 'all') {
    const label =
      rangeKey === 'custom' ? `Date: ${filters.start || '…'} – ${filters.end || '…'}` : `Date: ${RANGE_OPTIONS.find((o) => o.key === rangeKey)?.full ?? ''}`
    chips.push({ key: 'range', label, clear: () => applyRange('all') })
  }
  if (filters.category_id) {
    const c = categoryById.get(Number(filters.category_id))
    chips.push({ key: 'category_id', label: `Category: ${c ? c.path : filters.category_id}`, clear: () => clearField('category_id') })
  }
  if (filters.account_id) {
    const a = accountById.get(Number(filters.account_id))
    chips.push({ key: 'account_id', label: `Account: ${a ? a.name : filters.account_id}`, clear: () => clearField('account_id') })
  }

  const levels = (config?.levels.length ? config.levels : DEFAULT_LEVELS) ?? DEFAULT_LEVELS
  const categoryColumns: ColumnDef<Txn>[] = levels.map((label, i) => ({
    id: `category_${i}`,
    enableSorting: false,
    header: () => <span>{label}</span>,
    cell: ({ row }) => row.original.category_path?.split(' \u203a ')[i] ?? '',
  }))

  const columns: ColumnDef<Txn>[] = [
    {
      id: 'date',
      accessorKey: 'date',
      header: ({ column }) => <SortHeader column={column} label="Date" />,
      cell: ({ row }) => row.original.date,
    },
    {
      id: 'description',
      accessorKey: 'description',
      header: ({ column }) => <SortHeader column={column} label="Description" />,
      cell: ({ row }) => (
        <>
          {row.original.description}
          {row.original.planned && <span className="chip">planned</span>}
        </>
      ),
    },
    ...categoryColumns,
    {
      id: 'account',
      accessorKey: 'account_name',
      header: ({ column }) => <SortHeader column={column} label="Account" />,
      cell: ({ row }) => row.original.account_name ?? '—',
    },
    {
      id: 'amount',
      accessorKey: 'amount_cents',
      header: ({ column }) => <SortHeader column={column} label="Amount" />,
      cell: ({ row }) => (
        <span className={isIncomeKind(config, row.original.kind) ? 'under' : ''}>{formatMoney(row.original.amount_cents)}</span>
      ),
    },
  ]

  const table = useReactTable({
    data: items,
    columns,
    state: { sorting },
    onSortingChange,
    manualSorting: true,
    getCoreRowModel: getCoreRowModel(),
  })

  const cellClass = (id: string) =>
    id === 'amount' ? 'num' : id === 'account' ? 'hide-sm trunc' : id.startsWith('category_') ? 'trunc' : ''

  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>
          Transactions <span className="chip">{list.data?.total ?? '…'}</span>
        </h1>
        <span className="row-actions">
          <button
            className="icon-btn ghost"
            type="button"
            aria-label="Add transaction"
            data-tooltip-id="txn-tip"
            data-tooltip-content="Add transaction"
            onClick={() => setAdding(true)}
          >
            <img src="/static/add.svg?v=2" alt="" className="icon-img icon-img-lg" />
          </button>
          <button
            className="icon-btn ghost"
            type="button"
            aria-label="Import a bank/card CSV"
            data-tooltip-id="txn-tip"
            data-tooltip-content="Import a bank/card CSV"
            onClick={() => navigate('/import')}
          >
            <img src="/static/upload.svg?v=3" alt="" className="icon-img icon-img-lg" />
          </button>
        </span>
      </div>

      <form
        className="filter-bar"
        onSubmit={(e) => e.preventDefault()}
      >
        <div className="row">
          <div className="field-search">
            <label htmlFor="flt-q">Search</label>
            <input
              id="flt-q"
              type="search"
              placeholder="description or notes"
              value={draft.q}
              onChange={(e) => onSearchChange(e.target.value)}
            />
          </div>
          <div className="date-range">
            <label htmlFor="flt-range">Date range</label>
            <select
              id="flt-range"
              value={rangeKey}
              onChange={(e) => {
                const v = e.target.value as RangeKey
                if (v === 'custom') setCustomRange({ start: draft.start, end: draft.end })
                else applyRange(v)
              }}
            >
              {RANGE_OPTIONS.map((o) => (
                <option key={o.key} value={o.key}>
                  {o.full}
                </option>
              ))}
            </select>
          </div>
          <div className="field-cat">
            <CategoryFilter
              id="flt-cat"
              categories={categories.data ?? []}
              value={filters.category_id}
              onChange={(v) => applyField('category_id', v)}
              levelTo={1}
            />
          </div>
          <span className="btn-pair">
            <button
              className="icon-btn ghost"
              type="button"
              aria-label="Advanced filters"
              data-tooltip-id="txn-tip"
              data-tooltip-content="Advanced filters"
              onClick={() => setAdvanced(true)}
            >
              <img src="/static/filter.svg?v=3" alt="" className="icon-img icon-img-lg" />
            </button>
            <button
              className="icon-btn ghost"
              type="button"
              aria-label="Clear filters"
              data-tooltip-id="txn-tip"
              data-tooltip-content="Clear filters"
              onClick={clearFilters}
            >
              <img src="/static/clear.svg?v=5" alt="" className="icon-img icon-img-lg" />
            </button>
          </span>
        </div>
        {chips.length > 0 && (
          <div className="filter-chips">
            {chips.map((c) => (
              <button key={c.key} type="button" className="chip chip-clear" onClick={c.clear}>
                {c.label}
                <X size={13} />
              </button>
            ))}
            <button type="button" className="link-button" onClick={clearFilters}>
              Clear all
            </button>
          </div>
        )}
      </form>

      {advanced && (
        <Modal title="Advanced filters" onClose={() => setAdvanced(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              applyFilters()
              setAdvanced(false)
            }}
          >
            <div className="grid">
              <div className="field-cat">
                <CategoryFilter
                  id="flt-cat"
                  categories={categories.data ?? []}
                  value={draft.category_id}
                  onChange={(v) => setField('category_id', v)}
                  levelFrom={2}
                />
              </div>
              <div>
                <label htmlFor="flt-acc">Account</label>
                <AccountSelect
                  id="flt-acc"
                  accounts={accounts.data ?? []}
                  value={draft.account_id ? Number(draft.account_id) : null}
                  onChange={(id) => setField('account_id', id === null ? '' : String(id))}
                  blank="All accounts"
                />
              </div>
            </div>
            <div className="row" style={{ marginTop: 12 }}>
              <button
                className="secondary shrink"
                type="button"
                onClick={() => {
                  clearFilters()
                  setAdvanced(false)
                }}
              >
                Clear all
              </button>
              <button className="shrink push" type="submit">
                Apply filters
              </button>
            </div>
          </form>
        </Modal>
      )}

      {customRange && (
        <div className="modal-overlay center" onClick={() => setCustomRange(null)}>
          <div
            className="range-pop"
            role="dialog"
            aria-label="Custom date range"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="row">
              <div className="date-field">
                <label htmlFor="flt-start">From</label>
                <input
                  id="flt-start"
                  type="date"
                  value={customRange.start}
                  onChange={(e) => {
                    const n = { ...customRange, start: e.target.value }
                    setCustomRange(n)
                    if (n.start && n.end) applyRangeCustom(n)
                  }}
                />
              </div>
              <div className="date-field">
                <label htmlFor="flt-end">To</label>
                <input
                  id="flt-end"
                  type="date"
                  value={customRange.end}
                  onChange={(e) => {
                    const n = { ...customRange, end: e.target.value }
                    setCustomRange(n)
                    if (n.start && n.end) applyRangeCustom(n)
                  }}
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {list.isError && <div className="flash err">{list.error?.message ?? 'Failed to load'}</div>}
      <div className="card table-wrap">
        {list.isPending ? (
          <TableSkeleton levels={levels} />
        ) : (
          <table className="txn-table">
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className={cellClass(header.column.id)}
                      style={COL_WIDTH[header.column.id] ? { width: COL_WIDTH[header.column.id] } : undefined}
                    >
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr
                  key={row.id}
                  className={['clickable', row.original.planned ? 'planned' : ''].join(' ')}
                  onClick={() => navigate(`/transactions/${row.original.id}`, { state: { from } })}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') navigate(`/transactions/${row.original.id}`, { state: { from } })
                  }}
                  tabIndex={0}
                  role="link"
                  aria-label={`Edit ${row.original.description}`}
                >
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={cellClass(cell.column.id)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
              {list.data && items.length === 0 && (
                <tr>
                  <td colSpan={columns.length} className="muted">
                    No transactions match.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {list.data && list.data.pages > 1 && (
        <ReactPaginate
          pageCount={list.data.pages}
          forcePage={list.data.page - 1}
          onPageChange={({ selected: page }) => goToPage(page + 1)}
          previousLabel={<ChevronLeft size={16} />}
          nextLabel={<ChevronRight size={16} />}
          breakLabel="…"
          containerClassName="pagination"
          activeClassName="active"
          disabledClassName="disabled"
          breakClassName="break"
          marginPagesDisplayed={1}
          pageRangeDisplayed={3}
        />
      )}

      {adding && (
        <Modal title="Add transaction" onClose={() => setAdding(false)}>
          <TxnForm
            big
            initial={initial}
            descriptions={descriptions.data ?? []}
            submitLabel="Add"
            onSubmit={async (v) => {
              const created = await run(
                () => api.createTransaction(v),
                (t) => `Added ${t.description}`,
              )
              if (created) {
                setAdding(false)
                setInitial(blankForm(todayIso()))
              }
            }}
          />
        </Modal>
      )}

      <Tooltip id="txn-tip" />
    </>
  )
}