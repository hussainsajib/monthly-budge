import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { AccountSelect, CategorySelect } from '../components/selects'
import { Loading } from '../components/ui'
import { formatMoney } from '../money'
import { useAccounts, useCategories } from '../queries'
import { useRun, useToast } from '../toast'

const FILTER_KEYS = ['q', 'start', 'end', 'category_id', 'account_id'] as const

export default function TransactionsPage() {
  const [params, setParams] = useSearchParams()
  const location = useLocation()
  const run = useRun()
  const { fail } = useToast()
  const categories = useCategories()
  const accounts = useAccounts()
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [moveTo, setMoveTo] = useState<number | null>(null)

  const filters = Object.fromEntries([...FILTER_KEYS, 'page'].map((k) => [k, params.get(k) ?? '']))
  const list = useQuery({
    queryKey: ['transactions', 'list', filters],
    queryFn: () => api.transactions(filters),
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

  return (
    <>
      <h1>
        Transactions <span className="chip">{list.data?.total ?? '…'}</span>
      </h1>

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
            <select
              id="flt-cat"
              value={draft.category_id}
              onChange={(e) => setField('category_id', e.target.value)}
            >
              <option value="">All categories</option>
              {categories.data
                ?.filter((c) => c.depth >= 1)
                .map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.path}
                  </option>
                ))}
            </select>
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
          <button className="shrink" type="submit">
            Filter
          </button>
          <button className="secondary shrink" type="button" onClick={clearFilters}>
            Clear
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
        <button className="shrink" type="button" onClick={moveSelected} disabled={selected.size === 0}>
          Move selected{selected.size > 0 ? ` (${selected.size})` : ''}
        </button>
      </div>

      <Loading query={list} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>
                <input
                  type="checkbox"
                  aria-label="Select all"
                  checked={allSelected}
                  onChange={() => setSelected(allSelected ? new Set() : new Set(items.map((t) => t.id)))}
                />
              </th>
              <th>Date</th>
              <th>Description</th>
              <th>Category</th>
              <th className="hide-sm">Account</th>
              <th className="num">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {items.map((t) => (
              <tr key={t.id} className={t.planned ? 'planned' : ''}>
                <td>
                  <input
                    type="checkbox"
                    aria-label={`Select ${t.description}`}
                    checked={selected.has(t.id)}
                    onChange={() => toggle(t.id)}
                  />
                </td>
                <td>{t.date}</td>
                <td>
                  <Link to={`/transactions/${t.id}`} state={{ from }}>
                    {t.description}
                  </Link>
                  {t.planned && <span className="chip">planned</span>}
                </td>
                <td>{t.category_path}</td>
                <td className="hide-sm">{t.account_name ?? '—'}</td>
                <td className={`num${t.kind === 'income' ? ' under' : ''}`}>{formatMoney(t.amount_cents)}</td>
                <td className="num">
                  <Link to={`/transactions/${t.id}`} state={{ from }}>
                    Edit
                  </Link>
                </td>
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
      </div>

      {list.data && list.data.pages > 1 && (
        <div className="row small">
          <button
            className="secondary small shrink"
            disabled={list.data.page <= 1}
            onClick={() => goToPage(list.data.page - 1)}
          >
            ← Newer
          </button>
          <span className="muted shrink">
            Page {list.data.page} of {list.data.pages}
          </span>
          <button
            className="secondary small shrink"
            disabled={list.data.page >= list.data.pages}
            onClick={() => goToPage(list.data.page + 1)}
          >
            Older →
          </button>
        </div>
      )}
    </>
  )
}
