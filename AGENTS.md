# AGENTS.md

Project conventions. Follow these when building or editing the frontend UI.

## Stack

- Frontend: React 19 + Vite + TypeScript in `frontend/` (react-router, @tanstack/react-query).
- Backend: FastAPI + SQLAlchemy in `app/`; the React UI is served at `/`.
- No CSS framework — plain CSS with variables in `frontend/src/styles.css`.

## Frontend UI rules

- **Pickers:** category/account inputs MUST use the shared components in
  `frontend/src/components/selects.tsx` (`CategorySelect`, `CategoryFilter`,
  `AccountSelect`). They are searchable react-select controls with a cascading
  Category → Sub-category pair. Do **not** use native `<select>` for categories/accounts.
- **Tables:** use `@tanstack/react-table` **v8** (v9 renamed the API). Sorting is
  server-side — send `sort`/`dir` query params; see `TransactionsPage.tsx` and
  `app/services/transactions.py`.
- **Icons:** `lucide-react` named imports. **Tooltips:** `react-tooltip` (one
  `<Tooltip id=... />` per page, referenced via `data-tooltip-*`).
- **Pagination:** `react-paginate` (unwrap its `.default` — CJS interop). **Loading:**
  `react-content-loader` skeleton rows, not "Loading…" text.
- **Styling:** use the existing CSS variables (`--bg`, `--surface`, `--ink`, `--line`,
  `--accent`, …). Put new shared classes in `styles.css`. Support light and dark.
- **Design guardrails:** read `docs/design-guardrails.md` before any UI/styling
  change. Token-only colors/fonts (never hardcoded hex in components), one accent,
  no gradients, no shadows outside floating layers, no emoji, skeleton loaders not
  "Loading…", opinionated typography + tabular-nums for money. Run
  `npm run lint:design` after UI changes.
- **No code comments** unless the user asks.

## Backend touchpoints

- API handlers in `app/api/data.py` parse input and shape JSON; business rules live in
  `app/services/`. Money is integer cents. Migrations create schema only.

## Commands (run after UI changes)

```bash
# frontend/
npm run lint:design
npm run typecheck
npm run build

# repo root
pytest
ruff check .
```

## Reusable skills

Global skills (react-select pickers, TanStack tables, UI feedback, design
guardrails) are registered in `~/.config/opencode/opencode.jsonc` under
`skills.paths`, pointing at the `ai-skills` repo. They load automatically when a
task matches.
