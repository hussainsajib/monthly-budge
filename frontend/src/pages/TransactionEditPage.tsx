import { useQuery } from '@tanstack/react-query'
import { Trash, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { api } from '../api'
import TxnForm from '../components/TxnForm'
import { Loading } from '../components/ui'
import { centsToInput } from '../money'
import { useRun } from '../toast'

export default function TransactionEditPage() {
  const id = Number(useParams().id)
  const navigate = useNavigate()
  const location = useLocation()
  const run = useRun()
  const txn = useQuery({ queryKey: ['transactions', 'one', id], queryFn: () => api.transaction(id) })
  const back = (location.state as { from?: string } | null)?.from ?? '/transactions'
  const [dirty, setDirty] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [leaving, setLeaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty])

  if (!txn.data) {
    return (
      <div className="form-page">
        <h1>Edit transaction</h1>
        <Loading query={txn} />
      </div>
    )
  }
  const t = txn.data

  function goBack() {
    setConfirming(false)
    if (dirty) setLeaving(true)
    else navigate(back)
  }

  async function destroy() {
    setDeleting(true)
    const ok = await run(() => api.deleteTransaction(id).then(() => true), 'Deleted')
    setDeleting(false)
    if (ok) navigate(back)
  }

  return (
    <div className="form-page">
      <h1>Edit transaction</h1>
      <TxnForm
        plain
        stacked
        cascade
        autoFocus
        submitDisabled={!dirty}
        onDirtyChange={setDirty}
        initial={{
          date: t.date,
          description: t.description,
          category_id: t.category_id,
          account_id: t.account_id,
          amount: centsToInput(t.amount_cents),
          notes: t.notes ?? '',
        }}
        submitLabel="Save"
        onSubmit={async (v) => {
          if (await run(() => api.updateTransaction(id, v), 'Saved')) navigate(back)
        }}
        extra={
          <button type="button" className="secondary shrink with-icon" onClick={goBack}>
            <X size={16} /> Cancel
          </button>
        }
      />

      {leaving && (
        <div className="confirm-box" onKeyDown={(e) => e.key === 'Escape' && setLeaving(false)}>
          <p>
            Discard unsaved changes to <b>{t.description}</b>?
          </p>
          <div className="row">
            <button type="button" className="secondary shrink" autoFocus onClick={() => setLeaving(false)}>
              Keep editing
            </button>
            <button type="button" className="danger shrink" onClick={() => navigate(back)}>
              Discard
            </button>
          </div>
        </div>
      )}

      <div className="danger-zone">
        <h2>Delete</h2>
        {confirming ? (
          <div className="confirm-box" onKeyDown={(e) => e.key === 'Escape' && setConfirming(false)}>
            <p>
              Delete <b>{t.description}</b>? This removes it from your ledger and can't be undone.
            </p>
            <div className="row">
              <button
                type="button"
                className="danger shrink with-icon"
                disabled={deleting}
                onClick={() => void destroy()}
              >
                <Trash size={16} /> Delete
              </button>
              <button type="button" className="secondary shrink" autoFocus onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="row">
            <button
                type="button"
                className="secondary shrink with-icon"
                onClick={() => {
                  setLeaving(false)
                  setConfirming(true)
                }}
              >
                <Trash size={16} /> Delete transaction
              </button>
          </div>
        )}
      </div>
    </div>
  )
}
