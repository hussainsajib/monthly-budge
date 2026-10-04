# Design guardrails

This project's frontend follows an anti-AI-slop design contract. The current
`frontend/src/styles.css` `:root` token block IS the contract — do not drift from
it. The full reasoning and a generic checklist live in the global
`design-guardrails` skill.

## The contract (this repo)

- **Backgrounds:** warm paper, not pure white/gray. `--bg: #f6f6f4`,
  `--surface: #ffffff` (dark: `#121211` / `#1a1a19`).
- **One accent:** `--accent: #2a78d6` (dark `#3987e5`). No gradient buttons, no
  violet/indigo, no purple.
- **Flat surfaces:** cards and rows are defined by `1px solid var(--line)`, not
  `box-shadow`. Shadows allowed only on `.modal` and `.flash-wrap` (floating
  layers).
- **Radius:** 0–12px. Pills (`border-radius: 99px`) only for chips/badges/wizard
  steps, never for buttons or cards.
- **Money:** `font-variant-numeric: tabular-nums` everywhere amounts appear
  (`td.num` / `.num`, `.stat`, `.money`, `.tile-value`, `.budget-input`).
- **Type pairing:** Georgia serif display (`--font-display`) for headings and the
  brand; `system-ui` body (`--font-body`) everywhere else, numerals included
  (`--font-money` aliases `--font-body`, so figures match the text around them —
  `tabular-nums` keeps columns aligned). Add fonts as `--font-*` tokens in
  `styles.css`, never inline in components.
- **Loading:** skeleton rows via `react-content-loader` (`Bar` in
  `components/table.tsx`), never "Loading…" text.
- **Icons:** `lucide-react` named imports. No emoji.

## Forbidden (check with `npm run lint:design`)

- Hardcoded hex / font-family / radius in `.tsx`/`.ts` files — colors and fonts
  must come from the CSS variables.
- `linear-gradient` / `radial-gradient` / `conic-gradient` anywhere.
- `box-shadow` outside `.modal`, `.flash-wrap`, and dropdown menus.
- The default AI palette: `#6366f1`, `#8b5cf6`, `#7c3aed`, `#6d28d9`,
  `#4f46e5`, `#a855f7`, and any purple.
- Emoji characters in components.
- Placeholder copy: `Loading…`, `Loading...`, `No data`, `Coming soon`, `Lorem`.
- Inline `style={{ color: '#...' }}` overrides.

Line-scoped escape hatch: append `/* design-ok */` to exempt a single line (data-viz
colors only).

## Check command

```bash
cd frontend && npm run lint:design
```