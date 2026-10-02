import { useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { api } from '../api'
import { AccountSelect, CategorySelect } from '../components/selects'
import { NO_FILTERS, isFiltered, makeRowMatcher, type ImportFilters } from '../importFilter'
import { formatMoney } from '../money'
import { useAccounts, useCategories } from '../queries'
import type { ImportPreviewRow } from '../types'
import { useRun, useToast } from '../toast'

interface Row extends ImportPreviewRow {
  include: boolean
}

export default function ImportPage() {
  const run = useRun()
  const { fail } = useToast()
  const navigate = useNavigate()
  const categories = useCategories()
  const accounts = useAccounts()
  const fileRef = useRef<HTMLInputElement>(null)
  const [accountId, setAccountId] = useState<number | null>(null)
  const [amountSign, setAmountSign] = useState('positive_is_expense')
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [filters, setFilters] = useState<ImportFilters>(NO_FILTERS)
  const [bulkCategory, setBulkCategory] = useState<number | null>(null)
  const [onlyUnassigned, setOnlyUnassigned] = useState(true)

  async function preview(e: FormEvent) {
    e.preventDefault()
    const file = fileRef.current?.files?.[0]
    if (!file || busy) return
    const form = new FormData()
    form.append('file', file)
    if (accountId !== null) form.append('account_id', String(accountId))
    form.append('amount_sign', amountSign)
    setBusy(true)
    const result = await run(() => api.importPreview(form))
    setBusy(false)
    if (result) {
      setFilters(NO_FILTERS)
      setRows(result.map((r) => ({ ...r, include: !r.duplicate })))
    }
  }

  const patch = (index: number, change: Partial<Row>) =>
    setRows((rs) => rs && rs.map((r, i) => (i === index ? { ...r, ...change } : r)))

  const needsFix = (r: Row) => r.include && r.category_id === null

  function jumpToFirstFix() {
    const first = rows?.findIndex(needsFix) ?? -1
    if (first < 0 || !rows) return
    const hidden = !makeRowMatcher(filters, categories.data ?? [])(rows[first])
    if (hidden) setFilters(NO_FILTERS) // the row is filtered out: show everything so it can be seen
    // wait a moment so a cleared filter has rendered the row
    setTimeout(
      () => document.getElementById(`imp-row-${first}`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      hidden ? 50 : 0,
    )
  }

  async function commit() {
    if (!rows || busy) return
    const chosen = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.include)
    const missing = chosen.filter(({ r }) => r.category_id === null)
    if (missing.length > 0) {
      jumpToFirstFix()
      return fail(`${missing.length} ticked row(s) still need a category. They are highlighted; nothing was imported.`)
    }
    if (chosen.length === 0) return fail('Tick at least one row to import')
    setBusy(true)
    const done = await run(
      () =>
        api.importCommit(
          accountId,
          chosen.map(({ r }) => ({
            date: r.date,
            description: r.description,
            amount_cents: r.amount_cents,
            direction: r.direction,
            category_id: r.category_id,
            key: r.key,
          })),
        ),
      (r) => `Imported ${r.imported} transaction(s)`,
    )
    setBusy(false)
    if (done) navigate('/transactions')
  }

  if (rows) {
    const matches = makeRowMatcher(filters, categories.data ?? [])
    const visible = rows.map((r, i) => ({ r, i })).filter(({ r }) => matches(r))
    const visibleIndexes = new Set(visible.map(({ i }) => i))
    const allVisibleIncluded = visible.length > 0 && visible.every(({ r }) => r.include)
    const toFix = rows.filter(needsFix).length
    const months = [...new Set(rows.map((r) => r.date.slice(0, 7)))].sort()
    const years = [...new Set(rows.map((r) => r.date.slice(0, 4)))].sort()
    const setFilter = <K extends keyof ImportFilters>(key: K, value: ImportFilters[K]) =>
      setFilters((f) => ({ ...f, [key]: value }))

    const bulkTargets = visible.filter(({ r }) => !onlyUnassigned || r.category_id === null)
    const applyBulkCategory = () => {
      if (bulkCategory === null) return fail('Pick a category to apply')
      if (bulkTargets.length === 0) return fail('No shown rows to update')
      const targets = new Set(bulkTargets.map(({ i }) => i))
      setRows(rows.map((r, i) => (targets.has(i) ? { ...r, category_id: bulkCategory, include: true } : r)))
    }

    return (
      <>
        <h1>
          Review import <span className="chip">{rows.length} rows</span>
        </h1>
        {toFix > 0 && (
          <div className="flash err row" style={{ alignItems: 'center' }}>
            <span>
              <b>{toFix}</b> ticked row(s) need a category before you can import.
            </span>
            <button type="button" className="secondary small shrink" onClick={jumpToFirstFix}>
              Jump to first
            </button>
            <button
              type="button"
              className="secondary small shrink"
              onClick={() => setFilters({ ...NO_FILTERS, category: 'none' })}
            >
              Show only unassigned
            </button>
            <button
              type="button"
              className="secondary small shrink"
              onClick={() => setRows(rows.map((r) => (needsFix(r) ? { ...r, include: false } : r)))}
            >
              Untick them and import the rest
            </button>
          </div>
        )}

        <div className="card">
          <div className="grid">
            <div>
              <label htmlFor="if-text">Description contains</label>
              <input
                id="if-text"
                type="search"
                placeholder="e.g. SEND E-TFR"
                value={filters.text}
                onChange={(e) => setFilter('text', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="if-category">Category</label>
              <select id="if-category" value={filters.category} onChange={(e) => setFilter('category', e.target.value)}>
                <option value="">All categories</option>
                <option value="none">Unassigned</option>
                {categories.data?.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.path}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="if-year">Year</label>
              <select id="if-year" value={filters.year} onChange={(e) => setFilter('year', e.target.value)}>
                <option value="">All years</option>
                {years.map((y) => (
                  <option key={y} value={y}>
                    {y}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="if-month">Month</label>
              <select id="if-month" value={filters.month} onChange={(e) => setFilter('month', e.target.value)}>
                <option value="">All months</option>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="if-from">From</label>
              <input id="if-from" type="date" value={filters.from} onChange={(e) => setFilter('from', e.target.value)} />
            </div>
            <div>
              <label htmlFor="if-to">To</label>
              <input id="if-to" type="date" value={filters.to} onChange={(e) => setFilter('to', e.target.value)} />
            </div>
            <div>
              <label htmlFor="if-min">Amount from ($)</label>
              <input
                id="if-min"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={filters.min}
                onChange={(e) => setFilter('min', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="if-max">Amount to ($)</label>
              <input
                id="if-max"
                type="text"
                inputMode="decimal"
                placeholder="no limit"
                value={filters.max}
                onChange={(e) => setFilter('max', e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="if-dir">Money</label>
              <select
                id="if-dir"
                value={filters.direction}
                onChange={(e) => setFilter('direction', e.target.value as ImportFilters['direction'])}
              >
                <option value="">In and out</option>
                <option value="out">Out (expenses)</option>
                <option value="in">In (income)</option>
              </select>
            </div>
          </div>
          <div className="row" style={{ marginTop: 12, alignItems: 'center' }}>
            <span className="small muted">
              Showing <b>{visible.length}</b> of {rows.length} rows
            </span>
            {isFiltered(filters) && (
              <button type="button" className="secondary small shrink" onClick={() => setFilters(NO_FILTERS)}>
                Clear filters
              </button>
            )}
          </div>
        </div>

        <div className="card row" style={{ alignItems: 'end' }}>
          <div>
            <label htmlFor="if-bulk">Set category for the {visible.length} shown row(s)</label>
            <CategorySelect
              id="if-bulk"
              categories={categories.data ?? []}
              value={bulkCategory}
              onChange={setBulkCategory}
              blank="Choose category…"
            />
          </div>
          <label className="check shrink">
            <input type="checkbox" checked={onlyUnassigned} onChange={(e) => setOnlyUnassigned(e.target.checked)} />{' '}
            Only rows without a category
          </label>
          <button
            type="button"
            className="shrink"
            onClick={applyBulkCategory}
            disabled={bulkCategory === null || bulkTargets.length === 0}
          >
            Apply to {bulkTargets.length} row(s)
          </button>
        </div>

        <div className="card table-wrap">
          <table>
            <thead>
              <tr>
                <th>
                  <input
                    type="checkbox"
                    aria-label="Tick all shown rows"
                    checked={allVisibleIncluded}
                    onChange={() =>
                      setRows(rows.map((r, i) => (visibleIndexes.has(i) ? { ...r, include: !allVisibleIncluded } : r)))
                    }
                  />
                </th>
                <th>Date</th>
                <th>Description</th>
                <th>Category</th>
                <th className="num">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {visible.map(({ r, i }) => (
                <tr key={r.key} id={`imp-row-${i}`} className={needsFix(r) ? 'needs-fix' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      aria-label={`Import ${r.description}`}
                      checked={r.include}
                      onChange={(e) => patch(i, { include: e.target.checked })}
                    />
                  </td>
                  <td>{r.date}</td>
                  <td>{r.description}</td>
                  <td>
                    <CategorySelect
                      categories={categories.data ?? []}
                      value={r.category_id}
                      onChange={(id) => patch(i, { category_id: id })}
                    />
                  </td>
                  <td className={`num${r.direction === 'in' ? ' under' : ''}`}>
                    {r.direction === 'in' && '+'}
                    {formatMoney(r.amount_cents)}
                  </td>
                  <td>{r.duplicate && <span className="chip">possible duplicate</span>}</td>
                </tr>
              ))}
              {visible.length === 0 && (
                <tr>
                  <td colSpan={6} className="muted">
                    No rows match these filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="row">
          <button className="shrink" type="button" onClick={commit} disabled={busy}>
            Import ticked rows ({rows.filter((r) => r.include).length})
          </button>
          <button className="secondary shrink" type="button" onClick={() => setRows(null)}>
            Cancel
          </button>
        </div>
      </>
    )
  }

  return (
    <>
      <h1>Import from bank / card CSV</h1>
      <form className="card" onSubmit={preview}>
        <div className="grid">
          <div>
            <label htmlFor="imp-file">CSV file</label>
            <input id="imp-file" ref={fileRef} type="file" accept=".csv,text/csv" required />
          </div>
          <div>
            <label htmlFor="imp-account">Account these rows belong to</label>
            <AccountSelect id="imp-account" accounts={accounts.data ?? []} value={accountId} onChange={setAccountId} />
          </div>
          <div>
            <label htmlFor="imp-sign">Single "Amount" column means</label>
            <select id="imp-sign" value={amountSign} onChange={(e) => setAmountSign(e.target.value)}>
              <option value="positive_is_expense">Positive = money out (typical for credit cards)</option>
              <option value="negative_is_expense">Negative = money out (typical for chequing)</option>
            </select>
          </div>
        </div>
        <p className="small muted">
          Supported: TD-style files with no header (date, description, withdrawal, deposit, balance) and files with a
          header row containing Date, Description and Amount, or separate Debit/Credit columns. You will review and fix
          categories before anything is saved; likely duplicates are unticked.
        </p>
        <button type="submit" disabled={busy}>
          Preview
        </button>
      </form>
    </>
  )
}
