import { useEffect, useState, type FormEvent } from 'react'
import { api } from '../api'
import { Loading } from '../components/ui'
import { useAccountConfig, useCategoryConfig } from '../queries'
import { useRun } from '../toast'

export default function PreferencesTab() {
  const query = useCategoryConfig()
  const accounts = useAccountConfig().data
  const run = useRun()
  const config = query.data
  const [levels, setLevels] = useState<string[]>([])

  useEffect(() => {
    if (config) setLevels(config.levels)
  }, [config])

  const set = (i: number, value: string) => setLevels((prev) => prev.map((l, idx) => (idx === i ? value : l)))

  async function save(e: FormEvent) {
    e.preventDefault()
    await run(() => api.setLevels(levels), 'Saved')
  }

  return (
    <>
      <h1>Preferences</h1>
      <Loading query={query} />
      {config && (
        <>
          <form className="card" onSubmit={save}>
            <h2 style={{ marginTop: 0 }}>Level names</h2>
            <p className="small muted">
              Names shown when picking or managing categories. They are display-only — the four-level
              structure is unchanged.
            </p>
            <div className="grid">
              {levels.map((name, i) => (
                <div key={i}>
                  <label htmlFor={`lvl-${i}`}>Level {i + 1}</label>
                  <input
                    id={`lvl-${i}`}
                    type="text"
                    maxLength={40}
                    value={name}
                    onChange={(e) => set(i, e.target.value)}
                  />
                </div>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <button type="submit">Save</button>
            </div>
          </form>

          <div className="card table-wrap">
            <h2 style={{ marginTop: 0 }}>Category types</h2>
            <p className="small muted">
              The fixed set of types. Set a section's type under <b>Settings → Categories</b>; every
              sub-category inherits it.
            </p>
            <table>
              <thead>
                <tr>
                  <th>Type</th>
                  <th>Direction</th>
                </tr>
              </thead>
              <tbody>
                {config.types.map((t) => (
                  <tr key={t.key}>
                    <td>
                      <span className={`kind-dot ${t.key}`} /> {t.label}
                    </td>
                    <td>{t.direction === 'in' ? 'Money in' : 'Money out'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {accounts && (
            <div className="card table-wrap">
              <h2 style={{ marginTop: 0 }}>Account types</h2>
              <p className="small muted">
                The fixed set of account types, shown when adding or managing accounts.
              </p>
              <table>
                <thead>
                  <tr>
                    <th>Type</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.types.map((t) => (
                    <tr key={t.key}>
                      <td>
                        <span className={`kind-dot ${t.key}`} /> {t.label}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </>
  )
}