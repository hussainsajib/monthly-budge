import { useQuery } from '@tanstack/react-query'
import {
  flexRender,
  getCoreRowModel,
  useReactTable,
  type ColumnDef,
  type OnChangeFn,
  type SortingState,
} from '@tanstack/react-table'
import {
  ArrowRight,
  CalendarPlus,
  ChevronLeft,
  ChevronRight,
  ListFilter,
  Pencil,
  X,
} from 'lucide-react'
import { useState } from 'react'
import ReactPaginateImport from 'react-paginate'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { Tooltip } from 'react-tooltip'
import { api } from '../api'
import { AccountSelect, CategoryFilter, CategorySelect } from '../components/selects'
import { Bar, SortHeader } from '../components/table'
import TxnForm, { type TxnFormValues } from '../components/TxnForm'
import { formatMoney, todayIso } from '../money'
import { useAccounts, useCategories } from '../queries'
import { useRun, useToast } from '../toast'
import type { Txn } from '../types'

const FILTER_KEYS = ['q', 'start', 'end', 'category_id', 'account_id'] as const

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

function TableSkeleton() {
  const widths = [24, 80, 180, 150, 90, 80, 40]
  return (
    <table>
      <thead>
        <tr>
          <th />
          <th>Date</th>
          <th>Description</th>
          <th>Category</th>
          <th className="hide-sm">Account</th>
          <th className="num">Amount</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 8 }).map((_, row) => (
          <tr key={row}>
            {widths.map((w, col) => (
              <td key={col}>
                <Bar w={w} />
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
  const { fail } = useToast()
  const categories = useCategories()
  const accounts = useAccounts()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [moveTo, setMoveTo] = useState<number | null>(null)
  const descriptions = useQuery({ queryKey: ['transactions', 'descriptions'], queryFn: api.descriptions })
  const [initial, setInitial] = useState<TxnFormValues>(() => blankForm(todayIso()))
  const [formKey, setFormKey] = useState(0)
  const [month, setMonth] = useState(() => todayIso().slice(0, 7))
  const [sorting, setSorting] = useState<SortingState>([{ id: 'date', desc: true }])

  const reset = (values: TxnFormValues) => {
    setInitial(values)
    setFormKey((k) => k + 1)
  }

  const sort = sorting[0]?.id ?? 'date'
  const dir = sorting[0] && sorting[0].desc === false ? 'asc' : 'desc'

  const filters = Object.fromEntries([...FILTER_KEYS, 'page'].map((k) => [k, params.get(k) ?? '']))
  const list = useQuery({
    queryKey: ['transactions', 'list', filters, sort, dir],
    queryFn: () => api.transactions({ ...filters, sort, dir }),
  })

  // Filter edits live in the URL so a filtered view can be linked to (the Categories tab does this).
  const [draft, setDraft] = useState(() => Object.fromEntries(FILTER_KEYS.map((k) => [k, params.get(k) ?? ''])))
  const setField = (k: (typeof FILTER_KEYS)[number], v: string) => setDraft((d) => ({ ...d, [k]: v }))

  const applyFilters = () => {
    const next = new URLSearchParams()
    for (const k of FILTER_KEYS) if (draft[k]) next.set(k, draft[k])
    setSelected(new Set())
    setParams(next)
  }
  const clearFilters = () => {
    setDraft(Object.fromEntries(FILTER_KEYS.map((k) => [k, ''])))
    setSelected(new Set())
    setParams(new URLSearchParams())
  }
  const goToPage = (page: number) => {
    const next = new URLSearchParams(params)
    next.set('page', String(page))
    setSelected(new Set())
    setParams(next)
  }
  const onSortingChange: OnChangeFn<SortingState> = (updater) => {
    setSorting((prev) => (typeof updater === 'function' ? updater(prev) : updater))
    const next = new URLSearchParams(params)
    next.delete('page') // a new sort starts back on page 1
    setParams(next)
  }

  const items = list.data?.items ?? []
  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id))
  const toggle = (id: number) =>
    setSelected((s) => {
      const next = new Set(s)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  async function moveSelected() {
    if (selected.size === 0) return fail('Select at least one transaction')
    if (moveTo === null) return fail('Pick a category to move them to')
    const done = await run(
      () => api.bulkCategory([...selected], moveTo),
      (r) => `Moved ${r.moved} transaction(s)`,
    )
    if (done) setSelected(new Set())
  }

  const from = location.pathname + location.search

  const columns: ColumnDef<Txn>[] = [
    {
      id: 'select',
      enableSorting: false,
      header: () => (
        <input
          type="checkbox"
          aria-label="Select all"
          checked={allSelected}
          onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((t) => t.id)))}
        />
      ),
      cell: ({ row }) => (
        <input
          type="checkbox"
          aria-label={`Select ${row.original.description}`}
          checked={selected.has(row.original.id)}
          onChange={() => toggle(row.original.id)}
        />
      ),
    },
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
          <Link to={`/transactions/${row.original.id}`} state={{ from }}>
            {row.original.description}
          </Link>
          {row.original.planned && <span className="chip">planned</span>}
        </>
      ),
    },
    {
      id: 'category',
      accessorKey: 'category_path',
      header: ({ column }) => <SortHeader column={column} label="Category" />,
      cell: ({ row }) => row.original.category_path,
    },
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
        <span className={row.original.kind === 'income' ? 'under' : ''}>{formatMoney(row.original.amount_cents)}</span>
      ),
    },
    {
      id: 'actions',
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => (
        <Link
          to={`/transactions/${row.original.id}`}
          state={{ from }}
          aria-label="Edit"
          data-tooltip-id="txn-tip"
          data-tooltip-content="Edit"
        >
          <Pencil size={15} />
        </Link>
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
    id === 'amount' || id === 'actions' ? 'num' : id === 'account' ? 'hide-sm' : ''

  return (
    <>
      <div className="row" style={{ alignItems: 'center' }}>
        <h1 style={{ margin: 0 }}>
          Transactions <span className="chip">{list.data?.total ?? '…'}</span>
        </h1>
        <button
          className="secondary shrink with-icon"
          type="button"
          onClick={() => navigate('/import')}
          data-tooltip-id="txn-tip"
          data-tooltip-content="Import a bank/card CSV"
        >
          <img src="/static/shopping-cart.svg?v=3" alt="" className="icon-img" /> Import
        </button>
      </div>

      <TxnForm
        key={formKey}
        big
        initial={initial}
        descriptions={descriptions.data ?? []}
        submitLabel="Add"
        onSubmit={async (v) => {
          const created = await run(
            () => api.createTransaction(v),
            (t) => `Added ${t.description}`,
          )
          if (created) reset(blankForm(v.date)) // keep the date: entries usually come in batches
        }}
      />

      <form
        className="row"
        style={{ marginBottom: 16 }}
        onSubmit={(e) => {
          e.preventDefault()
          void run(() => api.generateRecurring(month), (r) => `Created ${r.created} recurring transaction(s)`)
        }}
      >
        <div>
          <label htmlFor="gen-month">Month</label>
          <input id="gen-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} required />
        </div>
        <button className="secondary shrink with-icon" type="submit">
          <CalendarPlus size={16} /> Add this month's recurring items
        </button>
      </form>

      <form
        className="card"
        onSubmit={(e) => {
          e.preventDefault()
          applyFilters()
        }}
      >
        <div className="row">
          <div>
            <label htmlFor="flt-q">Search</label>
            <input
              id="flt-q"
              type="search"
              placeholder="description or notes"
              value={draft.q}
              onChange={(e) => setField('q', e.target.value)}
            />
          </div>
          <div>
            <label htmlFor="flt-start">From</label>
            <input id="flt-start" type="date" value={draft.start} onChange={(e) => setField('start', e.target.value)} />
          </div>
          <div>
            <label htmlFor="flt-end">To</label>
            <input id="flt-end" type="date" value={draft.end} onChange={(e) => setField('end', e.target.value)} />
          </div>
          <div>
            <label htmlFor="flt-cat">Category (incl. sub-categories)</label>
            <CategoryFilter
              id="flt-cat"
              categories={categories.data ?? []}
              value={draft.category_id}
              onChange={(v) => setField('category_id', v)}
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
          <button className="shrink with-icon" type="submit">
            <ListFilter size={16} /> Filter
          </button>
          <button className="secondary shrink with-icon" type="button" onClick={clearFilters}>
            <X size={16} /> Clear
          </button>
        </div>
      </form>

      <div className="card row" style={{ alignItems: 'end' }}>
        <div>
          <label htmlFor="move-to">Move selected transactions to…</label>
          <CategorySelect
            id="move-to"
            categories={categories.data ?? []}
            value={moveTo}
            onChange={setMoveTo}
            blank="Choose category…"
          />
        </div>
        <button className="shrink with-icon" type="button" onClick={moveSelected} disabled={selected.size === 0}>
          <ArrowRight size={16} /> Move selected{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>

      {list.isError && <div className="flash err">{list.error?.message ?? 'Failed to load'}</div>}
      <div className="card table-wrap">
        {list.isPending ? (
          <TableSkeleton />
        ) : (
          <table>
            <thead>
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th key={header.id} className={cellClass(header.column.id)}>
                      {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {table.getRowModel().rows.map((row) => (
                <tr key={row.id} className={row.original.planned ? 'planned' : ''}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={cellClass(cell.column.id)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
              {list.data && items.length === 0 && (
                <tr>
                  <td colSpan={7} className="muted">
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

      <Tooltip id="txn-tip" />
    </>
  )
}