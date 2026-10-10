import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Check } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { api } from '../api'
import { isIncomeKind } from '../categoryConfig'
import { Loading } from '../components/ui'
import { Tooltip } from 'react-tooltip'
import { centsToInput, formatMoney, todayIso } from '../money'
import { useCategoryConfig } from '../queries'
import { useRun } from '../toast'
import type { BudgetLine } from '../types'

function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleString('en-CA', { month: 'long', year: 'numeric' })
}

/** Plain "1234.56" -> integer cents (template inputs; the server parser handles fancier sums for transactions). */
function parsePlain(text: string): number | null {
  const t = text.trim()
  if (t === '') return 0
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return null
  const neg = t.startsWith('-')
  const [int, frac = ''] = t.replace('-', '').split('.')
  const cents = Number(int) * 100 + Number((frac + '00').slice(0, 2))
  return (neg ? -1 : 1) * cents
}

/** On-screen editable budget for a leaf category. Plays nicely with the parent totals that live in `template`. */
function BudgetInput({
  cents,
  onCommit,
  label,
}: {
  cents: number
  onCommit: (v: number) => void
  label: string
}) {
  const [text, setText] = useState(centsToInput(cents))
  const [focused, setFocused] = useState(false)

  useEffect(() => {
    if (!focused) setText(centsToInput(cents))
  }, [cents, focused])

  function commit() {
    const parsed = parsePlain(text)
    if (parsed != null) {
      onCommit(parsed)
      setText(centsToInput(parsed))
    } else {
      setText(centsToInput(cents))
    }
  }

  return (
    <input
      className="budget-input"
      type="text"
      inputMode="decimal"
      aria-label={label}
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        commit()
      }}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      onChange={(e) => setText(e.target.value)}
    />
  )
}

export default function BudgetPage() {
  const run = useRun()
  const config = useCategoryConfig().data
  const [params, setParams] = useSearchParams()
  const month = params.get('month') || todayIso().slice(0, 7)
  const setMonth = (m: string) => m && setParams({ month: m })

  const query = useQuery({
    queryKey: ['budget', month],
    queryFn: () => api.budget(month),
    placeholderData: keepPreviousData,
  })
  const data = query.data

  // ---- on-screen template: leaf category_id -> planned cents -------------------------
  const [template, setTemplate] = useState<Record<number, number>>({})
  const [seededFor, setSeededFor] = useState<string | null>(null)

  useEffect(() => {
    if (!data || seededFor === data.month) return
    const m: Record<number, number> = {}
    for (const line of data.lines) if (!line.has_children) m[line.category_id] = line.budget_cents
    setTemplate(m)
    setSeededFor(data.month)
  }, [data, seededFor])

  const lines = data?.lines ?? []
  const defaults = Object.fromEntries(lines.filter((l) => !l.has_children).map((l) => [l.category_id, l.default_cents]))
  const childrenOf = new Map<number, BudgetLine[]>()
  for (const l of lines) {
    if (l.parent_id != null) childrenOf.set(l.parent_id, [...(childrenOf.get(l.parent_id) ?? []), l])
  }

  function leafIds(line: BudgetLine): number[] {
    if (!line.has_children) return [line.category_id]
    return (childrenOf.get(line.category_id) ?? []).flatMap(leafIds)
  }

  function treeBudget(line: BudgetLine): number {
    if (!line.has_children) return template[line.category_id] ?? 0
    return (childrenOf.get(line.category_id) ?? []).reduce((sum, k) => sum + treeBudget(k), 0)
  }

  function reset(line: BudgetLine) {
    const next = { ...template }
    for (const id of leafIds(line)) next[id] = defaults[id] ?? 0
    setTemplate(next)
  }

  const setLeaf = (id: number, v: number) => setTemplate((t) => ({ ...t, [id]: v }))

  const incomeBudgeted = lines.filter((l) => !l.has_children && isIncomeKind(config, l.kind)).reduce((s, l) => s + (template[l.category_id] ?? 0), 0)
  const expenseBudgeted = lines.filter((l) => !l.has_children && !isIncomeKind(config, l.kind)).reduce((s, l) => s + (template[l.category_id] ?? 0), 0)
  const unassigned = incomeBudgeted - expenseBudgeted

  async function generate() {
    if (!data) return
    if (!window.confirm(`Set ${monthLabel(month)}'s budgets from this template?`)) return
    const ok = await run(() => api.generateBudget(month, template), 'Generated')
    if (ok) query.refetch()
  }

  return (
    <>
      <h1>Budget Generator</h1>

      <Loading query={query} />
      {data && (
        <>
          <div className="card month-nav">
            <div className="stat">
              <div>
                <span className="muted small">Income planned</span>
                <b>{formatMoney(incomeBudgeted)}</b>
              </div>
              <div>
                <span className="muted small">Expenses planned</span>
                <b>{formatMoney(expenseBudgeted)}</b>
              </div>
              <div>
                <span className="muted small">Left to assign</span>
                <b className={unassigned === 0 ? 'zero-ok' : unassigned < 0 ? 'zero-bad' : ''}>
                  {formatMoney(unassigned)}
                </b>
              </div>
            </div>
            <div className="push inline-field-right">
              <div>
                <label htmlFor="bud-month">Month</label>
                <input id="bud-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
              </div>
              <button type="button" onClick={generate} disabled={!data}>
                Generate Budget
              </button>
            </div>
          </div>

          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Default</th>
                  <th className="num">Budget</th>
                  <th className="num">Recurring</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line) => {
                  const budget = treeBudget(line)
                  return (
                    <tr key={line.category_id} className={line.depth === 0 ? 'root' : ''}>
                      <td style={{ paddingLeft: 10 + line.depth * 18 }}>
                        {line.name}
                        {!line.is_active && <span className="chip">inactive</span>}
                      </td>
                      <td className="num muted">
                        {line.has_children ? formatMoney(line.default_cents, true) : formatMoney(line.default_cents, true)}
                      </td>
                      <td className="num">
                        {line.has_children ? (
                          formatMoney(budget, true)
                        ) : (
                          <BudgetInput cents={template[line.category_id] ?? 0} onCommit={(v) => setLeaf(line.category_id, v)} label={`${line.name} budget`} />
                        )}
                      </td>
                      <td className="num">{line.recurring_cents ? <Check size={16} aria-label="Recurring" /> : ''}</td>
                      <td className="num">
                        <button
                          type="button"
                          className="icon-btn ghost"
                          aria-label={`Reset ${line.name} to default`}
                          data-tooltip-id="budget-tip"
                          data-tooltip-content="Reset to default"
                          onClick={() => reset(line)}
                        >
                          <img src="/static/reset.svg?v=1" alt="" className="icon-img" />
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="total-row">
                  <td>Total income</td>
                  <td className="num muted">{formatMoney(lines.filter((l) => l.depth === 0 && isIncomeKind(config, l.kind)).reduce((s, l) => s + l.default_cents, 0))}</td>
                  <td className="num">{formatMoney(incomeBudgeted)}</td>
                  <td></td>
                  <td></td>
                </tr>
                <tr className="total-row">
                  <td>Total expenses</td>
                  <td className="num muted">{formatMoney(lines.filter((l) => l.depth === 0 && !isIncomeKind(config, l.kind)).reduce((s, l) => s + l.default_cents, 0))}</td>
                  <td className="num">{formatMoney(expenseBudgeted)}</td>
                  <td></td>
                  <td></td>
                </tr>
                <tr className="total-row">
                  <td>Income − expenses</td>
                  <td className="num"></td>
                  <td className={`num ${unassigned === 0 ? 'zero-ok' : unassigned < 0 ? 'zero-bad' : ''}`}>
                    {formatMoney(unassigned)}
                  </td>
                  <td></td>
                  <td></td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="small muted">
            This page is a template. Edit a budget and press Enter or click away; <b>Generate</b> writes it to the
            selected month. <b>Default</b> is the category's default (<b>Settings → Categories</b>); <b>Reset</b> puts a
            row back to it. <b>Recurring</b> shows recurring items for the month as commitments — they appear separately
            and never create transactions (those only come from manual entry or bulk import).
          </p>
          <Tooltip id="budget-tip" />
        </>
      )}
    </>
  )
}