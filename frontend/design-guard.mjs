#!/usr/bin/env node
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'

const ROOT = join(import.meta.dirname, 'src')
const ESCAPE = /\/\*\s*design-ok\s*\*\//
const SHADOW_ALLOW = /(\.modal|\.flash-wrap|rs__menu|\.dropdown|\.tooltip)/

const VIOLET_HEXES = ['#6366f1', '#8b5cf6', '#7c3aed', '#6d28d9', '#4f46e5', '#a855f7']
const EMOJI = /[\p{Extended_Pictographic}]/u
const PLACEHOLDER = /Loading…|Loading\.\.\.|No data|Coming soon|Lorem/
const GRADIENT = /\b(?:linear|radial|conic)-gradient/
const HEX = /#[0-9a-fA-F]{3,8}\b/
const INLINE_FONT = /font-family|font-size:\s*[0-9]+px|color:\s*#/
const PILL_RADIUS = /border-radius:\s*(?:999|9999)px/
const SHADOW = /(?<!-)box-shadow/

const matches = (line, re) => (re instanceof RegExp ? re.test(line) : re(line))

function violations(file, lines, check) {
  const out = []
  lines.forEach((line, i) => {
    if (ESCAPE.test(line)) return
    for (const [pred, msg] of check(line)) {
      if (matches(line, pred)) out.push(`${relative(ROOT, file)}:${i + 1}: ${msg}`)
    }
  })
  return out
}

const checks = {
  '.tsx': () => [
    [HEX, 'hardcoded hex color in component — use a CSS variable'],
    [GRADIENT, 'gradient is forbidden (flat surfaces only)'],
    [SHADOW, 'box-shadow in component — use borders / tokens'],
    [EMOJI, 'emoji in component — use lucide-react icons'],
    [PLACEHOLDER, 'placeholder copy — use skeletons / real content'],
    [INLINE_FONT, 'inline typography/color — use the theme tokens'],
  ],
  '.ts': () => [
    [HEX, 'hardcoded hex color outside theme'],
    [EMOJI, 'emoji in code — use lucide-react icons'],
    [PLACEHOLDER, 'placeholder copy — use skeletons / real content'],
  ],
  '.css': () => [
    [GRADIENT, 'gradient is forbidden (flat surfaces only)'],
    [(line) => VIOLET_HEXES.some((h) => line.toLowerCase().includes(h)), 'AI-default violet/indigo hex — use the theme accent'],
    [PILL_RADIUS, 'pill radius on non-chip element'],
  ],
}

function cssShadow(lines) {
  const out = []
  lines.forEach((line, i) => {
    if (!SHADOW.test(line) || ESCAPE.test(line)) return
    const ctx = lines.slice(Math.max(0, i - 3), i + 1).join('\n')
    if (!SHADOW_ALLOW.test(ctx)) {
      out.push(`styles.css:${i + 1}: box-shadow outside floating layer (.modal/.flash-wrap/dropdown)`)
    }
  })
  return out
}

function walk(dir) {
  const files = []
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) files.push(...walk(p))
    else if (name.endsWith('.tsx') || name.endsWith('.ts') || name.endsWith('.css')) files.push(p)
  }
  return files
}

const bad = []
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n')
  const ext = file.endsWith('.css') ? '.css' : file.endsWith('.tsx') ? '.tsx' : '.ts'
  bad.push(...violations(file, lines, checks[ext]))
  if (ext === '.css') bad.push(...cssShadow(lines))
}

if (bad.length) {
  console.error('design-guard:')
  for (const b of bad) console.error('  ' + b)
  console.error(`\n${bad.length} violation(s). Fix them, or add /* design-ok */ to exempt a line (data-viz colors only).`)
  process.exit(1)
}
console.log('design-guard: ok')