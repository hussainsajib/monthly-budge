import type { Account, Category } from '../types'

/** Deepest level a category can have a child under (server MAX_DEPTH is 4 levels: depth 0..3). */
const MAX_PARENT_DEPTH = 2

interface CategorySelectProps {
  categories: Category[]
  value: number | null
  onChange: (id: number | null) => void
  /** assignable: leaves a transaction may go under; parent: any node that can take a child. */
  mode?: 'assignable' | 'parent'
  blank?: string
  required?: boolean
  exclude?: Set<number>
  id?: string
}

export function CategorySelect({
  categories,
  value,
  onChange,
  mode = 'assignable',
  blank = 'Choose…',
  required = false,
  exclude,
  id,
}: CategorySelectProps) {
  const options = categories.filter((c) => {
    if (exclude?.has(c.id)) return false
    if (c.id === value) return true // keep the current choice visible even if archived
    if (!c.is_active) return false
    return mode === 'assignable' ? c.depth >= 1 : c.depth <= MAX_PARENT_DEPTH
  })
  return (
    <select
      id={id}
      value={value ?? ''}
      required={required}
      onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}
    >
      <option value="">{blank}</option>
      {options.map((c) => (
        <option key={c.id} value={c.id}>
          {c.path}
          {c.is_active ? '' : ' (inactive)'}
        </option>
      ))}
    </select>
  )
}

interface AccountSelectProps {
  accounts: Account[]
  value: number | null
  onChange: (id: number | null) => void
  blank?: string
  id?: string
}

export function AccountSelect({ accounts, value, onChange, blank = '— none —', id }: AccountSelectProps) {
  const options = accounts.filter((a) => a.is_active || a.id === value)
  return (
    <select id={id} value={value ?? ''} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))}>
      <option value="">{blank}</option>
      {options.map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
          {a.is_active ? '' : ' (inactive)'}
        </option>
      ))}
    </select>
  )
}
