# static/ assets — icon-button styling context

Reference for the icon-only ghost buttons (Add, Import, reset, save, etc.) and the
right-aligned action groups used across the app. Documented here so the pattern can be
replicated and drifted from intentionally.

## The recipe

### 1. Icon button (JSX)

```tsx
<button
  className="icon-btn ghost"
  type="button"
  aria-label="Import a bank/card CSV"
  data-tooltip-id="<page-tooltip-id>"
  data-tooltip-content="Import a bank/card CSV"
  onClick={...}
>
  <img src="/static/upload.svg?v=3" alt="" className="icon-img icon-img-lg" />
</button>
```

- Always provide an `aria-label` and a tooltip (`data-tooltip-*`).
- `icon-btn ghost` = transparent, borderless, 44px hit target, ink icon color, hover bg.
- `icon-img-lg` = 32px; `icon-img` = 16px.
- Icon-only action rows (page headers, filter/clear) must use **`icon-img-lg`**, matching
  Add/Upload, so the circular icon fills the button. A 16px `icon-img` in a 44px ghost
  button leaves a large empty area that reads as a visible box.

### 2. Right-align a group in a page header

Wrap the buttons in a `<span className="row-actions">`:

```tsx
<div className="row" style={{ alignItems: 'center' }}>
  <h1 style={{ margin: 0 }}>Transactions …</h1>
  <span className="row-actions">
    <button className="icon-btn ghost" ...>…</button>
    <button className="icon-btn ghost" ...>…</button>
  </span>
</div>
```

CSS (already in `styles.css`): `.row > .row-actions { flex: 0 1 auto; margin-left: auto; }`
overrides `.row > * { flex: 1 1 140px }`. Without this your buttons stretch and never
reach the right edge.

### 3. SVG asset rules

- Files live here in `frontend/public/static/`; Vite copies `public/` verbatim to `dist/`.
- Reference by URL with a cache-busting query: `/static/<name>.svg?v=N`. The backend
  serves `dist/static/*` with `Cache-Control: immutable` (1 year), so bump `?v=N` on every
  edit or the browser keeps the old icon.
- An SVG inside an `<img>` is color-isolated: `fill="currentColor"` renders black and CSS
  variables do not reach it.
- `button.ghost .icon-img { filter: none }` keeps the file's own fill. For the accent look,
  bake the color in: fill `#2a78d6` (accent blue), and use `fill-rule="evenodd"` for a
  filled circle with the glyph cut out (see `add.svg`, `upload.svg`).
- Non-ghost buttons invert imgs: `button:not(.secondary) .icon-img` -> white,
  `button.secondary .icon-img` -> dark.

### Glyph sizing (match add/upload exactly)

- Circle: a full 24-viewBox circle, `M12 2C6.477 2 2 6.477 2 12s4.477 10 10 10
  10-4.477 10-10S17.523 2 12 2z` (radius 10, centered on 12,12).
- Glyph: draw your icon at natural size, then scale it by **0.6 about the center**
  (`new = 12 + 0.6 * (old - 12)`) so it sits clearly inside the circle — same as the
  upload arrow/tray. A glyph spanning ~x7–17 / y7–17 full-size should end up about
  x8.5–15.5 / y8.4–15.4. Keep it centered on 12,12.
- Simple glyphs (plus, upload, X) use one `<path fill-rule="evenodd">` with the circle
  first, then the glyph. Complex filled glyphs (e.g. the filter funnel, or the clear
  funnel+X) are easier as a mask: a white full-size `<rect>` with the glyph drawn black,
  scaled via a group `transform="translate(12 12) scale(.6) translate(-12 -12)"`, applied
  with `mask="url(#cut)"` — see `filter.svg`, `clear.svg`.

### Adjacent icon buttons

For two icon-only buttons shown side by side (e.g. filter + clear), keep them tight by
wrapping them in `<span className="btn-pair">` instead of placing them as separate
`.row` children:

```tsx
<span className="btn-pair">
  <button className="icon-btn ghost" type="submit" aria-label="Apply filters" ...>
    <img src="/static/filter.svg?v=3" alt="" className="icon-img icon-img-lg" />
  </button>
  <button className="icon-btn ghost" type="button" aria-label="Clear filters" ...>
    <img src="/static/clear.svg?v=5" alt="" className="icon-img icon-img-lg" />
  </button>
</span>
```

CSS (in `styles.css`): `.btn-pair { display: inline-flex; align-items: center; gap: 2px; }`
and `.btn-pair .icon-btn { padding: 0; }`. Use `.btn-pair` (small gap, 2px) for tight
pairs; `.row-actions` (12px gap) for a looser header group.

## Existing reusable classes (styles.css)

- `.icon-btn`, `.icon-btn.ghost`, `.icon-btn.ghost:hover`
- `.icon-img`, `.icon-img-lg`
- `.row > .row-actions` (right-aligned no-grow action group)
- `.btn-pair` (tight 2px-gap group for two adjacent icon buttons)
- `.icon-group` (row-level inline action group, also right-aligned)

## Checks after a change

`npm run typecheck`, `npm run lint:design`, `npm run build` in `frontend/`, then restart
uvicorn / hard-refresh, and bump `?v=N` if the file changed.