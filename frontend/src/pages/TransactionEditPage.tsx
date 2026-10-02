import { useQuery } from '@tanstack/react-query'
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

  if (!txn.data) return <Loading query={txn} />
  const t = txn.data

  return (
    <>
      <h1>Edit transaction</h1>
      <TxnForm
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
          <>
            <button type="button" className="secondary shrink" onClick={() => navigate(back)}>
              Cancel
            </button>
            <button
              type="button"
              className="danger shrink"
              onClick={async () => {
                if (!window.confirm(`Delete "${t.description}"?`)) return
                if (await run(() => api.deleteTransaction(id).then(() => true), 'Deleted')) navigate(back)
              }}
            >
              Delete
            </button>
          </>
        }
      />
    </>
  )
}
