import type { Category } from './types'

/** A category's id plus the ids of everything below it. Categories arrive in tree order, so one pass is enough. */
export function subtreeIds(categories: Category[], rootId: number): Set<number> {
  const ids = new Set([rootId])
  for (const c of categories) if (c.parent_id !== null && ids.has(c.parent_id)) ids.add(c.id)
  return ids
}
