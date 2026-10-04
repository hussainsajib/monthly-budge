import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from '@tanstack/react-table'
import { Archive, ArchiveRestore, ChevronDown, ChevronRight, ChevronUp, Pencil, Trash, X } from 'lucide-react'
import { useMemo, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api, type CategoryBody } from '../api'
import { subtreeIds } from '../categoryTree'
import { CategorySelect } from '../components/selects'
import { Bar } from '../components/table'
import { Modal } from '../components/ui'
import { centsToInput, formatMoney } from '../money'
import { useCategories } from '../queries'
import { useRun } from '../toast'
import type { Category } from '../types'

interface Draft {
  name: string
  parent_id: number | null
  kind: string
  budget: string
  description: string
  is_active: boolean
}

const EMPTY: Draft = { name: '', parent_id: null, kind: 'expense', budget: '0', description: '', is_active: true }

const toDraft = (c: Category): Draft => ({
  name: c.name,
  parent_id: c.parent_id,
  kind: c.kind,
  budget: centsToInput(c.budget_cents),
  description: c.description,
  is_active: c.is_active,
})

const toBody = (d: Draft, sortOrder: number): CategoryBody => ({
  name: d.name.trim(),
  parent_id: d.parent_id,
  kind: d.kind,
  budget: d.budget,
  description: d.description,
  sort_order: sortOrder,
  is_active: d.is_active,
})

/** Whole-category payload, so a single-field change (reorder, archive) never clobbers the rest. */
const bodyOf = (c: Category, over: Partial<CategoryBody> = {}): CategoryBody => ({
  name: c.name,
  parent_id: c.parent_id,
  kind: c.kind,
  budget: centsToInput(c.budget_cents),
  description: c.description,
  sort_order: c.sort_order,
  is_active: c.is_active,
  ...over,
})

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

/** Transaction counts per category including everything beneath it. Categories arrive in tree order. */
function subtreeCounts(categories: Category[]): Map<number, number> {
  const totals = new Map<number, number>()
  for (let i = categories.length - 1; i >= 0; i--) {
    const c = categories[i]
    const sum = (totals.get(c.id) ?? 0) + c.transaction_count
    totals.set(c.id, sum)
    if (c.parent_id != null) totals.set(c.parent_id, (totals.get(c.parent_id) ?? 0) + sum)
  }
  return totals
}

/** Ids matching the query plus their ancestors, so a hit keeps its place in the tree. */
function matchesWithAncestors(categories: Category[], query: string): Set<number> {
  const byId = new Map(categories.map((c) => [c.id, c]))
  const keep = new Set<number>()
  for (const c of categories) {
    if (!c.path.toLowerCase().includes(query)) continue
    keep.add(c.id)
    for (let cur = byId.get(c.id); cur?.parent_id != null; cur = byId.get(cur.parent_id)) keep.add(cur.parent_id)
  }
  return keep
}

/** Drop inactive rows and everything under them, so no child is left parentless. */
function withoutInactive(categories: Category[]): Category[] {
  const out: Category[] = []
  let hideBelow = -1
  for (const c of categories) {
    if (hideBelow >= 0 && c.depth > hideBelow) continue
    hideBelow = c.is_active ? -1 : c.depth
    if (c.is_active) out.push(c)
  }
  return out
}

function siblingIds(categories: Category[], id: number): number[] {
  const target = categories.find((c) => c.id === id)
  if (!target) return []
  return categories.filter((c) => c.parent_id === target.parent_id).map((c) => c.id)
}

function DraftFields({
  draft,
  onChange,
  categories,
  idPrefix,
  exclude,
  showDescription,
  budgetLocked,
}: {
  draft: Draft
  onChange: (d: Draft) => void
  categories: Category[]
  idPrefix: string
  exclude?: Set<number>
  showDescription: boolean
  budgetLocked: boolean
}) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          required
          autoFocus
          maxLength={80}
          value={draft.name}
          onChange={(e) => set('name', e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-kind`}>Type (top-level only)</label>
        <select
          id={`${idPrefix}-kind`}
          value={draft.kind}
          disabled={draft.parent_id !== null}
          onChange={(e) => set('kind', e.target.value)}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
      </div>
      <div className="field-full">
        <CategorySelect
          id={`${idPrefix}-parent`}
          mode="parent"
          categories={categories}
          value={draft.parent_id}
          exclude={exclude}
          onChange={(id) => onChange({ ...draft, parent_id: id })}
          blank="— top-level section —"
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-budget`}>Default monthly budget ($)</label>
        <input
          id={`${idPrefix}-budget`}
          type="text"
          inputMode="decimal"
          value={draft.budget}
          disabled={budgetLocked}
          onChange={(e) => set('budget', e.target.value)}
        />
      </div>
      {showDescription && (
        <div>
          <label htmlFor={`${idPrefix}-desc`}>Description</label>
          <input
            id={`${idPrefix}-desc`}
            type="text"
            value={draft.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>
      )}
    </>
  )
}

function CategoriesSkeleton() {
  const widths = [240, 110, 80, 96]
  return (
    <table>
      <thead>
        <tr>
          <th>Name</th>
          <th className="num">Default budget/mo</th>
          <th className="num">Transactions</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: 7 }).map((_, row) => (
          <tr key={row}>
            {widths.map((w, col) => (
              <td key={col} className={col === 0 ? '' : 'num'}>
                <Bar w={w} />
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/** Opening view: everything folded away except the first section's own sub-categories. */
function defaultCollapsed(categories: Category[]): Set<number> {
  const openId = categories.find((c) => c.depth === 0)?.id
  return new Set(categories.filter((c) => c.has_children && c.id !== openId).map((c) => c.id))
}

export default function CategoriesTab() {
  const query = useCategories()
  const run = useRun()
  const categories = query.data ?? []

  const [q, setQ] = useState('')
  const [showInactive, setShowInactive] = useState(true)
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const [seeded, setSeeded] = useState(false)
  const [modal, setModal] = useState<{ mode: 'add' } | { mode: 'edit'; id: number } | null>(null)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [moveTo, setMoveTo] = useState<number | null>(null)
  const [moveError, setMoveError] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)

  // Seeded during render, not in an effect: the tree arrives async and an effect would flash every node open first.
  if (categories.length && !seeded) {
    setCollapsed(defaultCollapsed(categories))
    setSeeded(true)
  }

  const searching = q.trim().length > 0
  const totals = useMemo(() => subtreeCounts(categories), [categories])

  const base = useMemo(() => {
    const kept = searching ? matchesWithAncestors(categories, q.trim().toLowerCase()) : null
    const filtered = kept ? categories.filter((c) => kept.has(c.id)) : categories
    return showInactive ? filtered : withoutInactive(filtered)
  }, [categories, q, searching, showInactive])

  const rows = useMemo(() => {
    if (searching) return base
    const out: Category[] = []
    let hideBelow = -1
    for (const c of base) {
      if (hideBelow >= 0 && c.depth > hideBelow) continue
      hideBelow = -1
      out.push(c)
      if (collapsed.has(c.id) && c.has_children) hideBelow = c.depth
    }
    return out
  }, [base, collapsed, searching])

  const rowIds = new Set(rows.map((c) => c.id))
  const topLevel = rows.filter((c) => !rowIds.has(c.parent_id ?? -1))
  const grandBudget = topLevel.reduce((sum, c) => sum + c.effective_budget_cents, 0)
  const grandTx = topLevel.reduce((sum, c) => sum + (totals.get(c.id) ?? 0), 0)

  const sections = categories.filter((c) => c.depth === 0).length
  const inactive = categories.filter((c) => !c.is_active).length

  const editing = modal?.mode === 'edit' ? categories.find((c) => c.id === modal.id) : undefined
  const blocked = editing ? subtreeIds(categories, editing.id) : undefined
  const usage = editing ? editing.transaction_count + editing.recurring_count : 0
  const moveTarget = categories.find((c) => c.id === moveTo)

  function closeModal() {
    setModal(null)
    setMoveTo(null)
    setMoveError(null)
    setConfirming(false)
  }

  function openAdd() {
    setDraft(EMPTY)
    closeModal()
    setModal({ mode: 'add' })
  }

  function openEdit(c: Category) {
    setDraft(toDraft(c))
    setMoveTo(null)
    setMoveError(null)
    setConfirming(false)
    setModal({ mode: 'edit', id: c.id })
  }

  function toggleCollapse(id: number) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const { name, parent_id, kind, budget, description } = toBody(draft, 0)
    const created = await run(() => api.createCategory({ name, parent_id, kind, budget, description }), `Added ${name}`)
    if (created) closeModal()
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!editing) return
    const saved = await run(() => api.updateCategory(editing.id, toBody(draft, editing.sort_order)), 'Saved')
    if (saved) closeModal()
  }

  async function archive() {
    if (!editing) return
    const done = await run(
      () => api.updateCategory(editing.id, { ...toBody(draft, editing.sort_order), is_active: false }),
      `Archived ${editing.name}`,
    )
    if (done) closeModal()
  }

  function startDelete() {
    if (usage > 0 && moveTo === null) {
      setMoveError(`Choose where its ${plural(editing?.transaction_count ?? 0, 'transaction')} and ${plural(editing?.recurring_count ?? 0, 'recurring rule')} should go.`)
      return
    }
    setMoveError(null)
    setConfirming(true)
  }

  async function destroy() {
    if (!editing) return
    const done = await run(() => api.deleteCategory(editing.id, moveTo).then(() => true), `Deleted ${editing.name}`)
    if (done) closeModal()
  }

  async function move(id: number, dir: -1 | 1) {
    const sibs = siblingIds(categories, id)
    const i = sibs.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= sibs.length) return
    const a = categories.find((c) => c.id === sibs[i])
    const b = categories.find((c) => c.id === sibs[j])
    if (!a || !b) return
    const order = dir === 1 ? Math.max(a.sort_order, b.sort_order) + 10 : Math.min(a.sort_order, b.sort_order) - 10
    await run(() => api.updateCategory(a.id, bodyOf(a, { sort_order: order })), `Moved ${a.name}`)
  }

  const toggleActive = (c: Category) =>
    void run(
      () => api.updateCategory(c.id, bodyOf(c, { is_active: !c.is_active })),
      c.is_active ? `Archived ${c.name}` : `Restored ${c.name}`,
    )

  const columns: ColumnDef<Category>[] = [
    {
      id: 'name',
      accessorKey: 'name',
      enableSorting: false,
      header: () => 'Name',
      cell: ({ row }) => {
        const c = row.original
        const hidden = !searching && collapsed.has(c.id)
        return (
          <span className={`row-label cat-d${c.depth}`}>
            {c.has_children ? (
              <button
                type="button"
                className="twist"
                aria-expanded={!hidden}
                aria-label={`${hidden ? 'Expand' : 'Collapse'} ${c.name}`}
                data-tooltip-id="settings-tip"
                data-tooltip-content={hidden ? 'Expand' : 'Collapse'}
                onClick={() => toggleCollapse(c.id)}
              >
                {hidden ? <ChevronRight size={15} /> : <ChevronDown size={15} />}
              </button>
            ) : (
              <span className="twist-spacer" />
            )}
            <span className="nm">{c.name}</span>
            {!c.is_active && <span className="chip">inactive</span>}
            {c.depth === 0 && (
              <span className="chip">
                <span className={`kind-dot ${c.kind}`} /> {c.kind}
              </span>
            )}
          </span>
        )
      },
    },
    {
      id: 'budget',
      accessorKey: 'effective_budget_cents',
      enableSorting: false,
      header: () => 'Default budget/mo',
      cell: ({ row }) => {
        const c = row.original
        if (!c.has_children) {
          return c.budget_cents ? formatMoney(c.budget_cents) : <span className="empty-cell">—</span>
        }
        return (
          <span
            className="rollup"
            data-tooltip-id="settings-tip"
            data-tooltip-content={`Sum of ${plural(c.child_count, 'sub-category', 'sub-categories')}`}
          >
            {formatMoney(c.effective_budget_cents)}
          </span>
        )
      },
    },
    {
      id: 'transactions',
      accessorKey: 'transaction_count',
      enableSorting: false,
      header: () => 'Transactions',
      cell: ({ row }) => {
        const c = row.original
        const n = totals.get(c.id) ?? 0
        if (!n) return <span className="empty-cell">—</span>
        return (
          <Link
            to={`/transactions?category_id=${c.id}`}
            className="num-link"
            aria-label={`View ${plural(n, 'transaction')} in ${c.path}`}
            data-tooltip-id="settings-tip"
            data-tooltip-content={c.depth === 0 ? 'View every transaction in this section' : 'View transactions'}
          >
            {n}
          </Link>
        )
      },
    },
    {
      id: 'actions',
      enableSorting: false,
      header: () => null,
      cell: ({ row }) => {
        const c = row.original
        const sibs = siblingIds(categories, c.id)
        const i = sibs.indexOf(c.id)
        return (
          <span className="icon-group">
            <button
              type="button"
              className="icon-btn ghost"
              disabled={i <= 0}
              aria-label={`Move ${c.name} up`}
              data-tooltip-id="settings-tip"
              data-tooltip-content="Move up"
              onClick={() => void move(c.id, -1)}
            >
              <ChevronUp size={16} />
            </button>
            <button
              type="button"
              className="icon-btn ghost"
              disabled={i < 0 || i >= sibs.length - 1}
              aria-label={`Move ${c.name} down`}
              data-tooltip-id="settings-tip"
              data-tooltip-content="Move down"
              onClick={() => void move(c.id, 1)}
            >
              <ChevronDown size={16} />
            </button>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label={c.is_active ? `Archive ${c.name}` : `Restore ${c.name}`}
              data-tooltip-id="settings-tip"
              data-tooltip-content={c.is_active ? 'Archive' : 'Restore'}
              onClick={() => toggleActive(c)}
            >
              {c.is_active ? <Archive size={16} /> : <ArchiveRestore size={16} />}
            </button>
            <button
              type="button"
              className="icon-btn ghost"
              aria-label={`Edit ${c.name}`}
              data-tooltip-id="settings-tip"
              data-tooltip-content="Edit"
              onClick={() => openEdit(c)}
            >
              <Pencil size={18} />
            </button>
          </span>
        )
      },
    },
  ]

  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() })

  const cellClass = (id: string) => (id === 'name' || id === 'actions' ? '' : 'num')

  return (
    <>
      <div className="set-head">
        <h2>Categories</h2>
        <span className="set-counts">
          <span className="chip">{plural(sections, 'section')}</span>
          <span className="chip">{categories.length} in total</span>
          {inactive > 0 && <span className="chip">{inactive} inactive</span>}
        </span>
        <button
          className="push icon-btn ghost"
          type="button"
          aria-label="Add category"
          data-tooltip-id="settings-tip"
          data-tooltip-content="Add category"
          onClick={openAdd}
        >
          <img src="/static/add.svg?v=2" alt="" className="icon-img icon-img-lg" />
        </button>
      </div>

      {modal?.mode === 'add' && (
        <Modal title="Add category" onClose={closeModal}>
          <form onSubmit={add}>
            <div className="form-grid">
              <DraftFields
                draft={draft}
                onChange={setDraft}
                categories={categories}
                idPrefix="cat-new"
                showDescription={false}
                budgetLocked={false}
              />
            </div>
            <p className="small muted">
              Leave Section empty to create a new top-level group. Sub-categories inherit their parent's type, and
              budgets only apply at the lowest level — a parent shows the sum of its children.
            </p>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="shrink with-icon" type="submit">
                <img src="/static/add.svg?v=2" alt="" className="icon-img" /> Add
              </button>
              <button className="secondary shrink with-icon" type="button" onClick={closeModal}>
                <X size={16} /> Cancel
              </button>
            </div>
          </form>
        </Modal>
      )}

      {modal?.mode === 'edit' && editing && (
        <Modal title={`Edit ${editing.name}`} onClose={closeModal}>
          <form onSubmit={save}>
            <div className="form-grid">
              <DraftFields
                draft={draft}
                onChange={setDraft}
                categories={categories}
                idPrefix="cat-edit"
                exclude={blocked}
                showDescription
                budgetLocked={editing.has_children}
              />
            </div>
            {editing.has_children && (
              <p className="small muted">
                This budget is the sum of {plural(editing.child_count, 'sub-category', 'sub-categories')} — set it on the
                lowest level instead.
              </p>
            )}
            <label className="check">
              <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />{' '}
              Active — inactive categories are hidden from pickers but keep their history
            </label>
            <div className="row" style={{ marginTop: 8 }}>
              <button className="shrink with-icon" type="submit">
                <img src="/static/save.svg?v=2" alt="" className="icon-img" /> Save
              </button>
              <button className="secondary shrink with-icon" type="button" onClick={closeModal}>
                <X size={16} /> Cancel
              </button>
            </div>

            <div className="danger-zone">
              <h2>Delete</h2>
              {editing.has_children ? (
                <p className="small muted">Delete or move its {plural(editing.child_count, 'sub-category', 'sub-categories')} first.</p>
              ) : confirming ? (
                <div className="confirm-box">
                  <p>
                    Delete <b>{editing.name}</b>?
                    {usage > 0
                      ? ` Its ${plural(editing.transaction_count, 'transaction')} and ${plural(editing.recurring_count, 'recurring rule')} move to ${moveTarget?.path ?? 'the chosen category'}.`
                      : ' It has nothing attached, so this cannot be undone.'}
                  </p>
                  <div className="row">
                    <button className="danger shrink with-icon" type="button" onClick={destroy}>
                      <Trash size={16} /> Delete
                    </button>
                    <button className="secondary shrink" type="button" onClick={() => setConfirming(false)}>
                      Keep it
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {usage > 0 && (
                    <>
                      <p className="small muted">
                        Move its {plural(editing.transaction_count, 'transaction')} and {plural(editing.recurring_count, 'recurring rule')} somewhere else first.
                      </p>
                      <CategorySelect
                        id="cat-move"
                        categories={categories}
                        value={moveTo}
                        exclude={new Set([editing.id])}
                        onChange={(id) => {
                          setMoveTo(id)
                          setMoveError(null)
                        }}
                        blank="Choose category…"
                      />
                    </>
                  )}
                  {moveError && <p className="err-text">{moveError}</p>}
                  <div className="row" style={{ marginTop: 12 }}>
                    <button className="secondary shrink with-icon" type="button" onClick={archive}>
                      <Archive size={16} /> Archive instead
                    </button>
                    <button className="danger shrink with-icon" type="button" onClick={startDelete}>
                      <Trash size={16} /> Delete category
                    </button>
                  </div>
                </>
              )}
            </div>
          </form>
        </Modal>
      )}

      {query.isError && <div className="flash err">{query.error?.message ?? 'Failed to load'}</div>}

      <div className="set-toolbar">
        <div className="set-search">
          <label htmlFor="cat-filter">Search</label>
          <input
            id="cat-filter"
            type="search"
            placeholder="name or path"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <label className="check">
          <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} /> Show inactive
        </label>
        <span className="push-right small muted">
          {searching || !showInactive
            ? `${rows.length} of ${categories.length} shown`
            : 'Type is set per section and inherited below it'}
        </span>
      </div>

      <div className="card table-wrap">
        {query.isPending ? (
          <CategoriesSkeleton />
        ) : categories.length === 0 ? (
          <p className="muted">No categories yet. Add a top-level section to start organising your spending.</p>
        ) : rows.length === 0 ? (
          <p className="muted">
            Nothing matches “{q.trim()}”.{' '}
            <button type="button" className="link-button" onClick={() => { setQ(''); setShowInactive(true) }}>
              Clear filters
            </button>
          </p>
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
                <tr key={row.id} className={row.original.depth === 0 ? 'root cat-root' : ''}>
                  {row.getVisibleCells().map((cell) => (
                    <td key={cell.id} className={cellClass(cell.column.id)}>
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="total-row">
                <td>{rows.length === categories.length ? 'All categories' : 'Visible total'}</td>
                <td className="num">{formatMoney(grandBudget)}</td>
                <td className="num">{grandTx || <span className="empty-cell">—</span>}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        )}
      </div>
    </>
  )
}