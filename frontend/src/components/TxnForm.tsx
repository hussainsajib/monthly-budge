import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../api'
import { useAccounts, useCategories } from '../queries'
import { AccountSelect, CategorySelect } from './selects'

export interface TxnFormValues {
  date: string
  description: string
  category_id: number | null
  account_id: number | null
  amount: string
  notes: string
}

interface Props {
  initial: TxnFormValues
  submitLabel: string
  onSubmit: (values: TxnFormValues & { category_id: number }) => Promise<void>
  /** Known descriptions for the datalist; also enables autofill of category/account/amount. */
  descriptions?: string[]
  big?: boolean
  extra?: ReactNode
}

export default function TxnForm({ initial, submitLabel, onSubmit, descriptions, big, extra }: Props) {
  const categories = useCategories()
  const accounts = useAccounts()
  const [v, setV] = useState<TxnFormValues>(initial)
  const [busy, setBusy] = useState(false)
  const set = <K extends keyof TxnFormValues>(key: K, value: TxnFormValues[K]) => setV((p) => ({ ...p, [key]: value }))

  async function autofill(text: string) {
    if (!descriptions || !text.trim() || v.category_id !== null) return
    const hit = await api.suggest(text).catch(() => null)
    if (!hit) return
    // Re-check against the latest state: never overwrite something typed while the request was in flight.
    setV((p) =>
      p.category_id !== null
        ? p
        : {
            ...p,
            category_id: hit.category_id,
            account_id: p.account_id ?? hit.account_id,
            amount: p.amount.trim() ? p.amount : hit.amount,
          },
    )
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (v.category_id === null || busy) return
    setBusy(true)
    try {
      await onSubmit({ ...v, category_id: v.category_id })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className={`card${big ? ' big-form' : ''}`} onSubmit={submit}>
      <div className="grid">
        <div>
          <label htmlFor="f-desc">Description</label>
          <input
            id="f-desc"
            type="text"
            list={descriptions ? 'known-descriptions' : undefined}
            autoComplete="off"
            required
            value={v.description}
            onChange={(e) => {
              set('description', e.target.value)
              if (descriptions?.some((d) => d.toLowerCase() === e.target.value.trim().toLowerCase()))
                void autofill(e.target.value)
            }}
            onBlur={(e) => void autofill(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="f-amount">Amount (CAD)</label>
          <input
            id="f-amount"
            type="text"
            inputMode="decimal"
            placeholder="0.00"
            required
            value={v.amount}
            onChange={(e) => set('amount', e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="f-date">Date</label>
          <input id="f-date" type="date" required value={v.date} onChange={(e) => set('date', e.target.value)} />
        </div>
        <div>
          <CategorySelect
            id="f-category"
            categories={categories.data ?? []}
            value={v.category_id}
            onChange={(id) => set('category_id', id)}
            required
          />
        </div>
        <div>
          <label htmlFor="f-account">Account</label>
          <AccountSelect
            id="f-account"
            accounts={accounts.data ?? []}
            value={v.account_id}
            onChange={(id) => set('account_id', id)}
          />
        </div>
        <div>
          <label htmlFor="f-notes">Notes</label>
          <input id="f-notes" type="text" value={v.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
      {descriptions && (
        <datalist id="known-descriptions">
          {descriptions.map((d) => (
            <option key={d} value={d} />
          ))}
        </datalist>
      )}
      {descriptions && (
        <p className="small muted">
          Type a known description and the category, account and amount fill in automatically. Amounts like{' '}
          <code>61.09+1.37</code> work. Refunds: enter a negative amount.
        </p>
      )}
      <div className="row">
        <button type="submit" disabled={busy}>
          {submitLabel}
        </button>
        {extra}
      </div>
    </form>
  )
}
