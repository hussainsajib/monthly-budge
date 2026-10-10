import { useEffect, useState, type ReactNode } from 'react'
import Select, { type StylesConfig } from 'react-select'
import { levelsOf } from '../categoryConfig'
import { useCategoryConfig } from '../queries'
import type { Account, Category } from '../types'

/** Deepest level a category can have a child under (server MAX_DEPTH is 4 levels: depth 0..3). */
const MAX_PARENT_DEPTH = 2

/** Must match the separator the server builds category paths with (app/services/categories.py). */
const PATH_SEP = ' \u203a '

type Option = { value: string; label: string }

/** Shared react-select theme: matches the app's inputs and follows the light/dark CSS variables. */
export const selectStyles: StylesConfig<Option, false> = {
  container: (base, state) => (state.isDisabled ? { ...base, pointerEvents: 'auto' } : base),
  control: (base, state) => ({
    ...base,
    minHeight: 44,
    backgroundColor: 'var(--bg)',
    borderColor: state.isFocused ? 'var(--accent)' : 'var(--line)',
    boxShadow: state.isFocused ? '0 0 0 1px var(--accent)' : 'none',
    borderRadius: 8,
    cursor: state.isDisabled ? 'not-allowed' : 'default',
    opacity: state.isDisabled ? 0.5 : 1,
    ':hover': { borderColor: state.isFocused ? 'var(--accent)' : 'var(--line)' },
  }),
  menu: (base) => ({
    ...base,
    backgroundColor: 'var(--surface)',
    border: '1px solid var(--line)',
    borderRadius: 8,
    marginTop: 4,
    marginBottom: 4,
    zIndex: 30,
  }),
  menuPortal: (base) => ({ ...base, zIndex: 200 }),
  menuList: (base) => ({ ...base, backgroundColor: 'var(--surface)', padding: 4 }),
  option: (base, state) => ({
    ...base,
    backgroundColor: state.isSelected ? 'var(--accent)' : state.isFocused ? 'var(--bg)' : 'var(--surface)',
    color: state.isSelected ? 'var(--accent-ink)' : 'var(--ink)',
    cursor: 'pointer',
  }),
  singleValue: (base, state) => ({ ...base, color: state.isDisabled ? 'var(--muted)' : 'var(--ink)' }),
  input: (base) => ({ ...base, color: 'var(--ink)' }),
  placeholder: (base) => ({ ...base, color: 'var(--muted)' }),
  indicatorSeparator: (base) => ({ ...base, backgroundColor: 'var(--line)' }),
  dropdownIndicator: (base) => ({ ...base, color: 'var(--muted)' }),
  clearIndicator: (base) => ({ ...base, color: 'var(--muted)' }),
  noOptionsMessage: (base) => ({ ...base, color: 'var(--muted)' }),
  multiValue: (base) => ({ ...base, backgroundColor: 'var(--bg)', border: '1px solid var(--line)', borderRadius: 6 }),
  multiValueLabel: (base) => ({ ...base, color: 'var(--ink)' }),
  multiValueRemove: (base) => ({ ...base, color: 'var(--muted)', ':hover': { backgroundColor: 'transparent', color: 'var(--bad)' } }),
}

function rootOf(categories: Category[], id: number | null): number | null {
  if (id == null) return null
  const byId = new Map(categories.map((c) => [c.id, c]))
  let cur = byId.get(id)
  if (!cur) return null
  while (cur.parent_id != null) {
    const parent = byId.get(cur.parent_id)
    if (!parent) break
    cur = parent
  }
  return cur.id
}

function isUnder(categories: Category[], c: Category, rootId: number): boolean {
  const byId = new Map(categories.map((x) => [x.id, x]))
  let cur: Category | undefined = c
  while (cur && cur.parent_id != null) {
    if (cur.parent_id === rootId) return true
    cur = byId.get(cur.parent_id)
  }
  return false
}

function labelOf(c: Category, relativeTo?: Category): string {
  const name = relativeTo ? c.path.slice(relativeTo.path.length + PATH_SEP.length) : c.name
  return c.is_active ? name : `${name} (inactive)`
}

/** One column of a cascading pair: optional visible label above its select. */
function PairCol({ htmlFor, label, children }: { htmlFor?: string; label?: string; children: ReactNode }) {
  return (
    <span className="cat-col">
      {label ? <label htmlFor={htmlFor}>{label}</label> : null}
      {children}
    </span>
  )
}

interface CategorySelectProps {
  categories: Category[]
  value: number | null
  onChange: (id: number | null) => void
  /** assignable: leaves a transaction may go under; parent: any node that can take a child. */
  mode?: 'assignable' | 'parent'
  /** Blank label for the sub-category picker (assignable) or the top-level picker (parent). */
  blank?: string
  required?: boolean
  exclude?: Set<number>
  id?: string
  /** Set false in dense contexts (table cells) where the column headers would be noise. */
  showLabels?: boolean
}

export function CategorySelect({
  categories,
  value,
  onChange,
  mode = 'assignable',
  blank = 'Choose…',
  exclude,
  id,
  showLabels = true,
}: CategorySelectProps) {
  const parentMode = mode === 'parent'
  const levels = levelsOf(useCategoryConfig().data)
  const sections = categories.filter((c) => c.depth === 0)
  const [sectionId, setSectionId] = useState<number | null>(() => rootOf(categories, value))

  // Keep the category dropdown in sync when the value is set from outside (edit, autofill).
  // A null value means "nothing chosen yet", so it must not reset a section the user picked.
  useEffect(() => {
    if (value != null) setSectionId(rootOf(categories, value))
  }, [categories, value])

  const section = sectionId != null ? categories.find((c) => c.id === sectionId) : undefined

  const sectionOptions: Option[] = sections
    .filter((c) => c.id === sectionId || c.id === value || (c.is_active && !exclude?.has(c.id)))
    .map((c) => ({ value: String(c.id), label: labelOf(c) }))

  const subOptions: Option[] = categories
    .filter((c) => {
      if (sectionId == null || !isUnder(categories, c, sectionId)) return false
      if (c.id === value) return true // keep the current choice visible even if archived
      if (exclude?.has(c.id)) return false
      if (!c.is_active) return false
      if (parentMode && c.depth > MAX_PARENT_DEPTH) return false
      return true
    })
    .map((c) => ({ value: String(c.id), label: labelOf(c, section) }))

  if (parentMode && section) {
    subOptions.unshift({ value: String(section.id), label: `— ${section.name} —` })
  }

  const onSectionChange = (opt: Option | null) => {
    const next = opt ? Number(opt.value) : null
    setSectionId(next)
    onChange(parentMode ? next : null) // a section is a valid parent; otherwise clear the sub-category
  }

  const subDisabled = sectionId == null || subOptions.length === 0
  const subPlaceholder = sectionId == null ? (parentMode ? blank : 'Pick a category first') : blank

  return (
    <span className="cat-pair">
      <PairCol htmlFor={id} label={showLabels ? levels[0] : undefined}>
        <Select
          inputId={id}
          classNamePrefix="rs"
          menuPosition="fixed"
          menuPortalTarget={document.body}
          styles={selectStyles}
          isSearchable
          options={sectionOptions}
          value={sectionOptions.find((o) => o.value === String(sectionId)) ?? null}
          placeholder={parentMode ? blank : 'Choose…'}
          aria-label="Category"
          onChange={onSectionChange}
        />
      </PairCol>
      <PairCol htmlFor={id ? `${id}-sub` : undefined} label={showLabels ? levels[1] : undefined}>
        <Select
          inputId={id ? `${id}-sub` : undefined}
          classNamePrefix="rs"
          menuPosition="fixed"
          menuPortalTarget={document.body}
          styles={selectStyles}
          isSearchable
          options={subOptions}
          value={subOptions.find((o) => o.value === String(value)) ?? null}
          isDisabled={subDisabled}
          placeholder={subPlaceholder}
          aria-label="Sub-category"
          onChange={(opt) => onChange(opt ? Number(opt.value) : null)}
        />
      </PairCol>
    </span>
  )
}

interface CategoryFilterProps {
  categories: Category[]
  /** "" = any, "none" = unassigned, otherwise a category id as a string. */
  value: string
  onChange: (v: string) => void
  unassigned?: boolean
  id?: string
}

/** Two cascading selects for the Transactions / Import filters (a whole category matches its sub-categories). */
export function CategoryFilter({ categories, value, onChange, unassigned = false, id }: CategoryFilterProps) {
  const levels = levelsOf(useCategoryConfig().data)
  const sections = categories.filter((c) => c.depth === 0)
  const [sectionId, setSectionId] = useState<number | null>(() =>
    rootOf(categories, value && value !== 'none' ? Number(value) : null),
  )

  useEffect(() => {
    setSectionId(rootOf(categories, value && value !== 'none' ? Number(value) : null))
  }, [categories, value])

  const section = sectionId != null ? categories.find((c) => c.id === sectionId) : undefined

  const sectionOptions: Option[] = sections
    .filter((c) => c.is_active || c.id === sectionId)
    .map((c) => ({ value: String(c.id), label: labelOf(c) }))
  if (unassigned) sectionOptions.unshift({ value: 'none', label: 'Unassigned' })

  const subOptions: Option[] = section
    ? [
        { value: String(section.id), label: `— whole ${section.name} —` },
        ...categories
          .filter((c) => c.is_active && isUnder(categories, c, section.id))
          .map((c) => ({ value: String(c.id), label: labelOf(c, section) })),
      ]
    : []

  const onSectionChange = (opt: Option | null) => {
    if (!opt || opt.value === 'none') {
      setSectionId(null)
      onChange(opt?.value ?? '')
      return
    }
    setSectionId(Number(opt.value))
    onChange(opt.value) // filtering by a whole category includes its sub-categories
  }

  const firstValue = unassigned && value === 'none' ? sectionOptions[0] : (sectionOptions.find((o) => o.value === String(sectionId)) ?? null)

  return (
    <span className="cat-pair">
      <PairCol htmlFor={id} label={levels[0]}>
        <Select
          inputId={id}
          classNamePrefix="rs"
          menuPosition="fixed"
          menuPortalTarget={document.body}
          styles={selectStyles}
          isSearchable
          isClearable
          options={sectionOptions}
          value={firstValue}
          placeholder="All categories"
          aria-label="Category"
          onChange={onSectionChange}
        />
      </PairCol>
      <PairCol htmlFor={id ? `${id}-sub` : undefined} label={levels[1]}>
        <Select
          inputId={id ? `${id}-sub` : undefined}
          classNamePrefix="rs"
          menuPosition="fixed"
          menuPortalTarget={document.body}
          styles={selectStyles}
          isSearchable
          options={subOptions}
          value={subOptions.find((o) => o.value === value) ?? null}
          isDisabled={sectionId == null || subOptions.length === 0}
          placeholder="— whole category —"
          aria-label="Sub-category"
          onChange={(opt) => onChange(opt ? opt.value : String(sectionId))}
        />
      </PairCol>
    </span>
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
  const options: Option[] = accounts
    .filter((a) => a.is_active || a.id === value)
    .map((a) => ({ value: String(a.id), label: a.is_active ? a.name : `${a.name} (inactive)` }))
  return (
    <Select
      inputId={id}
      classNamePrefix="rs"
      menuPosition="fixed"
        menuPortalTarget={document.body}
      styles={selectStyles}
      isSearchable
      isClearable
      options={options}
      value={options.find((o) => o.value === String(value)) ?? null}
      placeholder={blank}
      aria-label="Account"
      onChange={(opt) => onChange(opt ? Number(opt.value) : null)}
    />
  )
}