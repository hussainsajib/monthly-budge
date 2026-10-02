import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import TxnForm, { type TxnFormValues } from '../components/TxnForm'
import { Loading } from '../components/ui'
import { centsToInput, formatMoney, todayIso } from '../money'
import type { Txn } from '../types'
import { useRun } from '../toast'

const blank = (date: string): TxnFormValues => ({
  date,
  description: '',
  category_id: null,
  account_id: null,
  amount: '',
  notes: '',
})

export default function AddPage() {
  const run = useRun()
  const recent = useQuery({ queryKey: ['transactions', 'recent'], queryFn: api.recentTransactions })
  const descriptions = useQuery({ queryKey: ['transactions', 'descriptions'], queryFn: api.descriptions })
  const [initial, setInitial] = useState<TxnFormValues>(() => blank(todayIso()))
  const [formKey, setFormKey] = useState(0)
  const [month, setMonth] = useState(() => todayIso().slice(0, 7))

  const reset = (values: TxnFormValues) => {
    setInitial(values)
    setFormKey((k) => k + 1)
  }

  const repeat = (t: Txn) =>
    reset({
      date: todayIso(),
      description: t.description,
      category_id: t.category_id,
      account_id: t.account_id,
      amount: centsToInput(t.amount_cents),
      notes: '',
    })

  return (
    <>
      <h1>Add transaction</h1>
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
          if (created) reset(blank(v.date)) // keep the date: entries usually come in batches
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
        <button className="secondary shrink" type="submit">
          Add this month's recurring items
        </button>
      </form>

      <h2>Recently added</h2>
      <Loading query={recent} />
      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Description</th>
              <th className="hide-sm">Category</th>
              <th className="num">Amount</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {recent.data?.map((t) => (
              <tr key={t.id}>
                <td>{t.date.slice(5)}</td>
                <td>
                  <Link to={`/transactions/${t.id}`}>{t.description}</Link>
                </td>
                <td className="hide-sm">{t.category_path}</td>
                <td className="num">{formatMoney(t.amount_cents)}</td>
                <td className="num">
                  <button type="button" className="secondary small" onClick={() => repeat(t)}>
                    Repeat
                  </button>
                </td>
              </tr>
            ))}
            {recent.data?.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Nothing yet. Add your first transaction above, or <Link to="/import">import a CSV</Link>.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  )
}
