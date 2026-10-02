import { useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api'
import { subtreeIds } from '../categoryTree'
import { CategorySelect } from '../components/selects'
import { Loading } from '../components/ui'
import { centsToInput, formatMoney } from '../money'
import { useCategories } from '../queries'
import { useRun } from '../toast'
import type { Category } from '../types'

function AddCategory({ categories }: { categories: Category[] }) {
  const run = useRun()
  const [name, setName] = useState('')
  const [parentId, setParentId] = useState<number | null>(null)
  const [kind, setKind] = useState('expense')
  const [budget, setBudget] = useState('0')

  async function submit(e: FormEvent) {
    e.preventDefault()
    const created = await run(
      () => api.createCategory({ name, parent_id: parentId, kind, budget }),
      `Added ${name.trim()}`,
    )
    if (created) {
      setName('')
      setBudget('0')
    }
  }

  return (
    <form className="card" onSubmit={submit}>
      <h2 style={{ marginTop: 0 }}>Add category or sub-category</h2>
      <div className="row">
        <div>
          <label htmlFor="cat-name">Name</label>
          <input id="cat-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="cat-parent">Parent</label>
          <CategorySelect
            id="cat-parent"
            mode="parent"
            categories={categories}
            value={parentId}
            onChange={setParentId}
            blank="— top-level section —"
          />
        </div>
        <div>
          <label htmlFor="cat-kind">Type (top-level only)</label>
          <select id="cat-kind" value={kind} disabled={parentId !== null} onChange={(e) => setKind(e.target.value)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
        <div>
          <label htmlFor="cat-budget">Default monthly budget ($)</label>
          <input
            id="cat-budget"
            type="text"
            inputMode="decimal"
            value={budget}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
        <button className="shrink" type="submit">
          Add
        </button>
      </div>
      <p className="small muted">
        Leave Parent empty to create a new top-level section (like "Fixed Expenses"). Sub-categories inherit their
        parent's type. Budgets apply to the lowest level; a parent shows the sum of its children. This is the default; change a single month on the Budget page.
      </p>
    </form>
  )
}

function EditCategory({ category, categories, onClose }: { category: Category; categories: Category[]; onClose: () => void }) {
  const run = useRun()
  const [name, setName] = useState(category.name)
  const [parentId, setParentId] = useState(category.parent_id)
  const [kind, setKind] = useState<string>(category.kind)
  const [budget, setBudget] = useState(centsToInput(category.budget_cents))
  const [description, setDescription] = useState(category.description)
  const [sortOrder, setSortOrder] = useState(category.sort_order)
  const [active, setActive] = useState(category.is_active)
  const [moveTo, setMoveTo] = useState<number | null>(null)

  const blocked = subtreeIds(categories, category.id)

  async function save(e: FormEvent) {
    e.preventDefault()
    const saved = await run(
      () =>
        api.updateCategory(category.id, {
          name,
          parent_id: parentId,
          kind,
          budget,
          description,
          sort_order: sortOrder,
          is_active: active,
        }),
      'Saved',
    )
    if (saved) onClose()
  }

  async function remove() {
    const needsMove = category.transaction_count > 0
    if (needsMove && moveTo === null) return window.alert(`Choose a category to move its ${category.transaction_count} transaction(s) to first.`)
    if (!window.confirm(`Delete "${category.name}"?`)) return
    const done = await run(() => api.deleteCategory(category.id, moveTo).then(() => true), 'Deleted')
    if (done) onClose()
  }

  return (
    <form className="card" onSubmit={save}>
      <h2 style={{ marginTop: 0 }}>Edit {category.name}</h2>
      <div className="grid">
        <div>
          <label htmlFor="ce-name">Name</label>
          <input id="ce-name" type="text" required value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label htmlFor="ce-parent">Parent</label>
          <CategorySelect
            id="ce-parent"
            mode="parent"
            categories={categories}
            value={parentId}
            exclude={blocked}
            onChange={setParentId}
            blank="— top-level section —"
          />
        </div>
        <div>
          <label htmlFor="ce-kind">Type (top-level only)</label>
          <select id="ce-kind" value={kind} disabled={parentId !== null} onChange={(e) => setKind(e.target.value)}>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
          </select>
        </div>
        <div>
          <label htmlFor="ce-budget">Default monthly budget ($)</label>
          <input
            id="ce-budget"
            type="text"
            inputMode="decimal"
            value={category.has_children ? centsToInput(category.effective_budget_cents) : budget}
            disabled={category.has_children}
            onChange={(e) => setBudget(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ce-sort">Sort order</label>
          <input id="ce-sort" type="number" value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
        </div>
        <div>
          <label htmlFor="ce-desc">Description</label>
          <input id="ce-desc" type="text" value={description} onChange={(e) => setDescription(e.target.value)} />
        </div>
      </div>
      <p>
        <label>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Active (inactive
          categories are hidden from pickers but keep their history)
        </label>
      </p>
      {category.has_children && <p className="small muted">Budget is the sum of its sub-categories.</p>}
      <div className="row">
        <button className="shrink" type="submit">
          Save
        </button>
        <button className="secondary shrink" type="button" onClick={onClose}>
          Cancel
        </button>
      </div>

      <h2>Delete</h2>
      {category.has_children ? (
        <p className="small muted">Delete or move its sub-categories first.</p>
      ) : (
        <div className="row">
          {category.transaction_count > 0 && (
            <div>
              <label htmlFor="ce-move">Move its {category.transaction_count} transaction(s) to</label>
              <CategorySelect
                id="ce-move"
                categories={categories}
                value={moveTo}
                exclude={new Set([category.id])}
                onChange={setMoveTo}
                blank="Choose category…"
              />
            </div>
          )}
          <button className="danger shrink" type="button" onClick={remove}>
            Delete category
          </button>
        </div>
      )}
    </form>
  )
}

export default function CategoriesTab() {
  const query = useCategories()
  const [editingId, setEditingId] = useState<number | null>(null)
  const categories = query.data ?? []
  const editing = categories.find((c) => c.id === editingId)

  return (
    <>
      <Loading query={query} />
      {editing ? (
        <EditCategory key={editing.id} category={editing} categories={categories} onClose={() => setEditingId(null)} />
      ) : (
        <AddCategory categories={categories} />
      )}

      <div className="card table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th className="num">Default budget/mo</th>
              <th className="num">Transactions</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id} className={c.depth === 0 ? 'root' : ''}>
                <td style={{ paddingLeft: 10 + c.depth * 22 }}>
                  <button type="button" className="link-button" onClick={() => setEditingId(c.id)}>
                    {c.name}
                  </button>
                  {!c.is_active && <span className="chip">inactive</span>}
                </td>
                <td>{c.kind}</td>
                <td className="num">{formatMoney(c.effective_budget_cents, true)}</td>
                <td className="num">{c.transaction_count || ''}</td>
                <td className="num">
                  {c.depth >= 1 && (
                    <>
                      <Link to={`/transactions?category_id=${c.id}`}>View</Link> ·{' '}
                    </>
                  )}
                  <button type="button" className="link-button" onClick={() => setEditingId(c.id)}>
                    Edit
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  )
}
