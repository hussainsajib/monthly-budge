import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { Loading } from '../components/ui'
import { centsToInput, formatMoney, todayIso } from '../money'
import { useRun } from '../toast'
import type { BudgetLine } from '../types'

function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number)
  const d = new Date(y, m - 1 + delta, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-CA', { month: 'long', year: 'numeric' })
}

/** Editable budget for a leaf category. Saves when the field loses focus and the value changed. */
function BudgetInput({ month, line }: { month: string; line: BudgetLine }) {
  const run = useRun()
  const [value, setValue] = useState(centsToInput(line.budget_cents))
  const [busy, setBusy] = useState(false)

  async function save() {
    if (busy || value.trim() === centsToInput(line.budget_cents)) return
    setBusy(true)
    const ok = await run(() => api.setBudget(month, line.category_id, value))
    setBusy(false)
    if (!ok) setValue(centsToInput(line.budget_cents)) // revert on error (the toast shows why)
  }

  return (
    <input
      className={`budget-input${line.is_override ? ' custom' : ''}`}
      type="text"
      inputMode="decimal"
      aria-label={`${line.name} budget`}
      value={value}
      disabled={busy}
      title={line.is_override ? `Customised for this month (default ${formatMoney(line.default_cents)})` : undefined}
      onChange={(e) => setValue(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}

export default function BudgetPage() {
  const run = useRun()
  const [params, setParams] = useSearchParams()
  const month = params.get('month') || todayIso().slice(0, 7)
  const setMonth = (m: string) => m && setParams({ month: m })

  const query = useQuery({
    queryKey: ['budget', month],
    queryFn: () => api.budget(month),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  async function copyPrevious() {
    if (!window.confirm(`Replace ${monthLabel(month)}'s budget with ${monthLabel(shiftMonth(month, -1))}'s?`)) return
    await run(
      () => api.copyPreviousBudget(month),
      (r) => (r.changed ? `Updated ${r.changed} budget line(s)` : 'Already the same as last month'),
    )
  }

  return (
    <>
      <h1>Budget — {monthLabel(month)}</h1>

      <div className="card month-nav">
        <button type="button" className="secondary shrink" onClick={() => setMonth(shiftMonth(month, -1))}>
          ← Previous
        </button>
        <div>
          <label htmlFor="bud-month">Month</label>
          <input id="bud-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
        </div>
        <button type="button" className="secondary shrink" onClick={() => setMonth(shiftMonth(month, 1))}>
          Next →
        </button>
        <button type="button" className="secondary shrink" onClick={copyPrevious}>
          Copy last month's budget
        </button>
      </div>

      <Loading query={query} />
      {data && (
        <>
          <div className="card stat">
            <div>
              <span className="muted small">Income budgeted</span>
              <b>{formatMoney(data.income_budget)}</b>
              <span className="small muted">received {formatMoney(data.income_actual)}</span>
            </div>
            <div>
              <span className="muted small">Expenses budgeted</span>
              <b>{formatMoney(data.expense_budget)}</b>
              <span className="small muted">spent {formatMoney(data.expense_actual)}</span>
            </div>
            <div>
              <span className="muted small">Left to assign</span>
              <b className={data.unassigned === 0 ? 'zero-ok' : data.unassigned < 0 ? 'zero-bad' : ''}>
                {formatMoney(data.unassigned)}
              </b>
              <span className="small muted">
                {data.unassigned === 0
                  ? 'Every dollar has a job'
                  : data.unassigned > 0
                    ? 'income not yet given a budget'
                    : 'budgeted more than income'}
              </span>
            </div>
          </div>

          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num hide-sm">Default</th>
                  <th className="num">Budget</th>
                  <th className="num">Actual</th>
                  <th className="num">Remaining</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.lines.map((line) => {
                  const over = line.kind === 'expense' && line.remaining_cents < 0
                  return (
                    <tr key={line.category_id} className={line.depth === 0 ? 'root' : ''}>
                      <td style={{ paddingLeft: 10 + line.depth * 18 }}>
                        {line.name}
                        {!line.is_active && <span className="chip">inactive</span>}
                      </td>
                      <td className="num hide-sm muted">
                        {line.has_children || line.default_cents === line.budget_cents
                          ? ''
                          : formatMoney(line.default_cents, true)}
                      </td>
                      <td className="num">
                        {line.has_children || line.depth === 0 ? (
                          formatMoney(line.budget_cents, true)
                        ) : (
                          // keyed by value so the field resets when a refetch brings a new server amount
                          <BudgetInput key={`${line.category_id}:${line.budget_cents}`} month={month} line={line} />
                        )}
                      </td>
                      <td className="num">{formatMoney(line.actual_cents, true)}</td>
                      <td className={`num${over ? ' over' : ''}`}>
                        {line.budget_cents || line.actual_cents ? formatMoney(line.remaining_cents) : ''}
                      </td>
                      <td className="num">
                        {line.is_override && (
                          <button
                            type="button"
                            className="link-button small"
                            onClick={() =>
                              void run(() => api.setBudget(month, line.category_id, null), 'Back to the default')
                            }
                          >
                            Reset
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td>Total income</td>
                  <td className="hide-sm"></td>
                  <td className="num">{formatMoney(data.income_budget)}</td>
                  <td className="num">{formatMoney(data.income_actual)}</td>
                  <td className="num">{formatMoney(data.income_budget - data.income_actual)}</td>
                  <td></td>
                </tr>
                <tr className="total-row">
                  <td>Total expenses</td>
                  <td className="hide-sm"></td>
                  <td className="num">{formatMoney(data.expense_budget)}</td>
                  <td className="num">{formatMoney(data.expense_actual)}</td>
                  <td className={`num${data.expense_actual > data.expense_budget ? ' over' : ''}`}>
                    {formatMoney(data.expense_budget - data.expense_actual)}
                  </td>
                  <td></td>
                </tr>
                <tr className="total-row">
                  <td>Income − expenses</td>
                  <td className="hide-sm"></td>
                  <td className={`num ${data.unassigned === 0 ? 'zero-ok' : data.unassigned < 0 ? 'zero-bad' : ''}`}>
                    {formatMoney(data.unassigned)}
                  </td>
                  <td className={`num ${data.income_actual - data.expense_actual < 0 ? 'zero-bad' : ''}`}>
                    {formatMoney(data.income_actual - data.expense_actual)}
                  </td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="small muted">
            Edit a budget and press Enter or click away to save it for this month only. Outlined amounts differ from the
            category's default (<b>Settings → Categories</b>); Reset puts them back. Nothing rolls over: each month
            starts from the defaults. Actuals include future-dated entries in the month.
          </p>
        </>
      )}
    </>
  )
}
