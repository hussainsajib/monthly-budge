import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { AccountSelect, CategorySelect } from '../components/selects'
import { Loading } from '../components/ui'
import { centsToInput } from '../money'
import { useAccounts, useCategories } from '../queries'
import { useRun } from '../toast'
import type { Recurring } from '../types'
import { useQuery } from '@tanstack/react-query'

interface Draft {
  description: string
  category_id: number | null
  account_id: number | null
  amount: string
  day_of_month: number
  is_active: boolean
}

const EMPTY: Draft = { description: '', category_id: null, account_id: null, amount: '', day_of_month: 1, is_active: true }

const fromTemplate = (t: Recurring): Draft => ({
  description: t.description,
  category_id: t.category_id,
  account_id: t.account_id,
  amount: centsToInput(t.amount_cents),
  day_of_month: t.day_of_month,
  is_active: t.is_active,
})

function Fields({ draft, onChange, idPrefix }: { draft: Draft; onChange: (d: Draft) => void; idPrefix: string }) {
  const categories = useCategories()
  const accounts = useAccounts()
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-desc`}>Description</label>
        <input
          id={`${idPrefix}-desc`}
          type="text"
          required
          value={draft.description}
          onChange={(e) => set('description', e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-cat`}>Category</label>
        <CategorySelect
          id={`${idPrefix}-cat`}
          categories={categories.data ?? []}
          value={draft.category_id}
          onChange={(id) => set('category_id', id)}
          required
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-acc`}>Account</label>
        <AccountSelect
          id={`${idPrefix}-acc`}
          accounts={accounts.data ?? []}
          value={draft.account_id}
          onChange={(id) => set('account_id', id)}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-amt`}>Amount ($)</label>
        <input
          id={`${idPrefix}-amt`}
          type="text"
          inputMode="decimal"
          required
          value={draft.amount}
          onChange={(e) => set('amount', e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-day`}>Day of month</label>
        <input
          id={`${idPrefix}-day`}
          type="number"
          min={1}
          max={31}
          required
          value={draft.day_of_month}
          onChange={(e) => set('day_of_month', Number(e.target.value))}
        />
      </div>
    </>
  )
}

function toBody(d: Draft) {
  return { ...d, category_id: d.category_id as number }
}

function TemplateRow({ template }: { template: Recurring }) {
  const run = useRun()
  const [draft, setDraft] = useState(fromTemplate(template))
  const dirty = JSON.stringify(draft) !== JSON.stringify(fromTemplate(template))

  return (
    <form
      className="row account-row"
      onSubmit={(e) => {
        e.preventDefault()
        if (draft.category_id !== null) void run(() => api.updateRecurring(template.id, toBody(draft)), 'Saved')
      }}
    >
      <Fields draft={draft} onChange={setDraft} idPrefix={`rec-${template.id}`} />
      <label className="check shrink">
        <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />{' '}
        Active
      </label>
      <button className="shrink" type="submit" disabled={!dirty}>
        Save
      </button>
      <button
        className="danger shrink"
        type="button"
        onClick={() => {
          if (window.confirm(`Delete "${template.description}"?`))
            void run(() => api.deleteRecurring(template.id), 'Deleted')
        }}
      >
        Delete
      </button>
    </form>
  )
}

export default function RecurringTab() {
  const run = useRun()
  const query = useQuery({ queryKey: ['recurring'], queryFn: api.recurring })
  const [draft, setDraft] = useState<Draft>(EMPTY)

  async function add(e: FormEvent) {
    e.preventDefault()
    if (draft.category_id === null) return
    if (await run(() => api.createRecurring(toBody(draft)), `Added ${draft.description.trim()}`)) setDraft(EMPTY)
  }

  return (
    <>
      <form className="card" onSubmit={add}>
        <h2 style={{ marginTop: 0 }}>Add recurring item</h2>
        <div className="row">
          <Fields draft={draft} onChange={setDraft} idPrefix="rec-new" />
          <button className="shrink" type="submit">
            Add
          </button>
        </div>
        <p className="small muted">
          Use <b>Add this month's recurring items</b> on the Add page to create these as transactions. It skips ones
          that already exist for the month.
        </p>
      </form>

      <Loading query={query} />
      {query.data && (
        <div className="card">
          {query.data.length === 0 && <p className="muted">No recurring items yet.</p>}
          {query.data.map((t) => (
            <TemplateRow key={`${t.id}:${JSON.stringify(t)}`} template={t} />
          ))}
        </div>
      )}
    </>
  )
}
