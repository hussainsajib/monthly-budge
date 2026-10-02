import { useState, type FormEvent } from 'react'
import { api } from '../api'
import { Loading } from '../components/ui'
import { centsToInput } from '../money'
import { useAccounts } from '../queries'
import { useRun } from '../toast'
import type { Account } from '../types'

const KINDS = ['bank', 'credit', 'cash']

interface Draft {
  name: string
  kind: string
  opening_balance: string
  opening_date: string
  is_active: boolean
}

const EMPTY: Draft = { name: '', kind: 'bank', opening_balance: '0', opening_date: '', is_active: true }

function fromAccount(a: Account): Draft {
  return {
    name: a.name,
    kind: a.kind,
    opening_balance: centsToInput(a.opening_balance_cents),
    opening_date: a.opening_date ?? '',
    is_active: a.is_active,
  }
}

function DraftFields({ draft, onChange, idPrefix }: { draft: Draft; onChange: (d: Draft) => void; idPrefix: string }) {
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => onChange({ ...draft, [k]: v })
  return (
    <>
      <div>
        <label htmlFor={`${idPrefix}-name`}>Name</label>
        <input id={`${idPrefix}-name`} type="text" required value={draft.name} onChange={(e) => set('name', e.target.value)} />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-kind`}>Type</label>
        <select id={`${idPrefix}-kind`} value={draft.kind} onChange={(e) => set('kind', e.target.value)}>
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor={`${idPrefix}-bal`}>Opening balance ($)</label>
        <input
          id={`${idPrefix}-bal`}
          type="text"
          inputMode="decimal"
          value={draft.opening_balance}
          onChange={(e) => set('opening_balance', e.target.value)}
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-date`}>Opening date</label>
        <input
          id={`${idPrefix}-date`}
          type="date"
          value={draft.opening_date}
          onChange={(e) => set('opening_date', e.target.value)}
        />
      </div>
    </>
  )
}

const toBody = (d: Draft) => ({ ...d, opening_date: d.opening_date || null })

function AccountRow({ account }: { account: Account }) {
  const run = useRun()
  const [draft, setDraft] = useState(fromAccount(account))
  const dirty = JSON.stringify(draft) !== JSON.stringify(fromAccount(account))

  return (
    <form
      className="row account-row"
      onSubmit={(e) => {
        e.preventDefault()
        void run(() => api.updateAccount(account.id, toBody(draft)), 'Saved')
      }}
    >
      <DraftFields draft={draft} onChange={setDraft} idPrefix={`acc-${account.id}`} />
      <label className="check shrink">
        <input type="checkbox" checked={draft.is_active} onChange={(e) => setDraft({ ...draft, is_active: e.target.checked })} />{' '}
        Active
      </label>
      <button className="shrink" type="submit" disabled={!dirty}>
        Save
      </button>
    </form>
  )
}

export default function AccountsTab() {
  const run = useRun()
  const query = useAccounts()
  const [draft, setDraft] = useState<Draft>(EMPTY)

  async function add(e: FormEvent) {
    e.preventDefault()
    if (await run(() => api.createAccount(toBody(draft)), `Added ${draft.name.trim()}`)) setDraft(EMPTY)
  }

  return (
    <>
      <form className="card" onSubmit={add}>
        <h2 style={{ marginTop: 0 }}>Add account</h2>
        <div className="row">
          <DraftFields draft={draft} onChange={setDraft} idPrefix="acc-new" />
          <button className="shrink" type="submit">
            Add
          </button>
        </div>
        <p className="small muted">
          Cash flow starts from the opening balance on the opening date, so set both for any account you want a running
          balance for.
        </p>
      </form>

      <Loading query={query} />
      {query.data && (
        <div className="card">
          {query.data.map((a) => (
            <AccountRow key={`${a.id}:${JSON.stringify(a)}`} account={a} />
          ))}
        </div>
      )}
    </>
  )
}
