import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { api } from '../api'
import { Loading } from '../components/ui'
import { MONTHS, formatMoney } from '../money'

const dollars = (v: unknown) => formatMoney(Math.round(Number(v) * 100))

export default function ReportsPage() {
  const [year, setYear] = useState(new Date().getFullYear())
  const [month, setMonth] = useState<number | null>(null) // null = last month with activity
  const report = useQuery({
    queryKey: ['report', year, month],
    queryFn: () => api.report(year, month),
    placeholderData: keepPreviousData,
  })
  const r = report.data

  return (
    <>
      <h1>Budget tracker — {year}</h1>

      <div className="card row">
        <div>
          <label htmlFor="rep-year">Year</label>
          <input
            id="rep-year"
            type="number"
            min={2000}
            max={2100}
            value={year}
            onChange={(e) => e.target.value && setYear(Number(e.target.value))}
          />
        </div>
        <div>
          <label htmlFor="rep-month">Month for category chart</label>
          <select
            id="rep-month"
            value={r?.month ?? ''}
            onChange={(e) => setMonth(Number(e.target.value))}
          >
            {MONTHS.map((m, i) => (
              <option key={m} value={i + 1}>
                {m}
              </option>
            ))}
          </select>
        </div>
      </div>

      <Loading query={report} />
      {r && (
        <>
          <div className="card stat">
            <div>
              <span className="muted small">Avg monthly spending</span>
              <b>{formatMoney(r.avg_expense)}</b>
            </div>
            <div>
              <span className="muted small">Monthly budget</span>
              <b>{formatMoney(r.expense_budget)}</b>
            </div>
            <div>
              <span className="muted small">Net this year</span>
              <b className={sum(r.net_months) >= 0 ? 'under' : 'over'}>{formatMoney(sum(r.net_months))}</b>
            </div>
          </div>

          <div className="charts">
            <div className="card">
              <h2 style={{ marginTop: 0 }}>Spending vs income by month</h2>
              <div className="chart-box">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={r.chart.months.map((m, i) => ({ month: m, Spending: r.chart.spending[i], Income: r.chart.income[i] }))}>
                    <CartesianGrid stroke="var(--line)" vertical={false} />
                    <XAxis dataKey="month" stroke="var(--muted)" />
                    <YAxis stroke="var(--muted)" />
                    <Tooltip formatter={dollars} contentStyle={tooltipStyle} />
                    <Legend />
                    <Bar dataKey="Spending" fill="var(--series-2)" radius={[3, 3, 0, 0]} />
                    <Bar dataKey="Income" fill="var(--series-1)" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
            <div className="card">
              <h2 style={{ marginTop: 0 }}>{MONTHS[r.month - 1]}: top categories vs budget</h2>
              <div className="chart-box">
                {r.chart.categories.length === 0 ? (
                  <p className="muted">No spending in {MONTHS[r.month - 1]}.</p>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      layout="vertical"
                      data={r.chart.categories.map((c, i) => ({
                        category: c,
                        Actual: r.chart.category_actual[i],
                        Budget: r.chart.category_budget[i],
                      }))}
                    >
                      <CartesianGrid stroke="var(--line)" horizontal={false} />
                      <XAxis type="number" stroke="var(--muted)" />
                      <YAxis type="category" dataKey="category" width={130} stroke="var(--muted)" />
                      <Tooltip formatter={dollars} contentStyle={tooltipStyle} />
                      <Legend />
                      <Bar dataKey="Actual" fill="var(--series-2)" radius={[0, 3, 3, 0]} />
                      <Bar dataKey="Budget" fill="var(--track)" radius={[0, 3, 3, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>
          </div>

          <h2>Category × month</h2>
          <div className="card table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Category</th>
                  <th className="num">Budget/mo</th>
                  {MONTHS.map((m) => (
                    <th key={m} className="num">
                      {m}
                    </th>
                  ))}
                  <th className="num">Total</th>
                  <th className="num">Avg</th>
                  <th className="num">vs Budget</th>
                </tr>
              </thead>
              <tbody>
                {r.rows.map((row) => (
                  <tr key={row.category_id} className={row.depth === 0 ? 'root' : ''}>
                    <td style={{ paddingLeft: 10 + row.depth * 18 }}>{row.name}</td>
                    <td className="num">{formatMoney(row.budget, true)}</td>
                    {row.months.map((c, i) => (
                      <td key={i} className="num">
                        {formatMoney(c, true)}
                      </td>
                    ))}
                    <td className="num">{formatMoney(row.total, true)}</td>
                    <td className="num">{formatMoney(row.avg, true)}</td>
                    <td className={`num ${row.status}`}>{formatMoney(row.variance, true)}</td>
                  </tr>
                ))}
                <tr className="root">
                  <td>NET (income − expenses)</td>
                  <td className="num">{formatMoney(r.income_budget - r.expense_budget)}</td>
                  {r.net_months.map((c, i) => (
                    <td key={i} className="num">
                      {formatMoney(c, true)}
                    </td>
                  ))}
                  <td className="num">{formatMoney(sum(r.net_months))}</td>
                  <td></td>
                  <td></td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="small muted">
            vs Budget = average of months with activity − monthly budget (for expenses, positive means over budget).
            Parent budgets are the sum of their sub-categories. Future-dated entries are excluded.
          </p>
        </>
      )}
    </>
  )
}

const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0)

const tooltipStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--line)',
  borderRadius: 8,
  color: 'var(--ink)',
}
