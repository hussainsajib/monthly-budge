export function Loading({ query }: { query: { isPending: boolean; isError: boolean; error: Error | null } }) {
  if (query.isError) return <div className="flash err">{query.error?.message ?? 'Failed to load'}</div>
  if (query.isPending) return <p className="muted">Loading…</p>
  return null
}
