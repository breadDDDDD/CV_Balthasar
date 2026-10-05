// Port of backend/app/render (templates/cv.html.j2, html.py, common.py). The preview and the HTML
// export are drawn here so typing never reaches the backend; the backend draws the same markup for
// the PDF and the page count. The fixtures in backend/tests/golden keep the two identical
// (`npm test`), so change both sides together.
import type { Bullet, CV, Contact, Item, Section, SectionType, Style } from './types'

const FONT_STACKS: Record<string, string> = {
  arial: "Arial, 'Liberation Sans', Arimo, Helvetica, sans-serif",
  calibri: "Calibri, Carlito, 'Liberation Sans', sans-serif",
  times: "'Times New Roman', 'Liberation Serif', Tinos, Times, serif",
  cambria: "Cambria, Caladea, 'Liberation Serif', Georgia, serif",
}
const PAGE_SIZES_MM = { A4: [210, 297], Letter: [215.9, 279.4] } as const

const SECTION_TYPES: SectionType[] = [
  'summary',
  'experience',
  'education',
  'projects',
  'skills',
  'certifications',
  'organizations',
  'volunteer',
  'awards',
  'languages',
  'publications',
  'custom',
]
const CONTACT_KINDS: Contact['kind'][] = ['phone', 'email', 'location', 'linkedin', 'github', 'website', 'other']

/* ---------- defaults, as the backend's schema fills them ---------- */

type Obj = Record<string, unknown>
const obj = (v: unknown): Obj => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Obj) : {})
const list = (v: unknown): Obj[] => (Array.isArray(v) ? v.map(obj) : [])
const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback)
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback
const num = (v: unknown, min: number, max: number, fallback: number): number =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback

const bullets = (v: unknown, prefix: string): Bullet[] =>
  list(v).map((b, i) => ({ id: str(b.id, `${prefix}_${i}`), text: str(b.text) }))

/** The CV with every missing or invalid field set to the backend default, so older or partial
 * documents (an old tab, a hand-edited file) draw the way the backend would draw them. */
export function withDefaults(raw: unknown): CV {
  const cv = obj(raw)
  const header = obj(cv.header)
  const style = obj(cv.style)
  const accent = str(style.accent_color).trim()
  return {
    version: typeof cv.version === 'number' ? cv.version : 1,
    header: {
      name: str(header.name),
      headline: str(header.headline),
      contacts: list(header.contacts).map((c, i) => ({
        id: str(c.id, `ctc_${i}`),
        kind: pick(c.kind, CONTACT_KINDS, 'other'),
        text: str(c.text),
        url: typeof c.url === 'string' ? c.url : null,
      })),
    },
    sections: list(cv.sections).map((s, i) => ({
      id: str(s.id, `sec_${i}`),
      type: pick(s.type, SECTION_TYPES, 'custom'),
      title: str(s.title),
      title_url: typeof s.title_url === 'string' ? s.title_url : null,
      show_title: bool(s.show_title, true),
      visible: bool(s.visible, true),
      text: str(s.text),
      bullets: bullets(s.bullets, `blt_${i}`),
      items: list(s.items).map((it, j) => ({
        id: str(it.id, `itm_${i}_${j}`),
        title: str(it.title),
        subtitle: str(it.subtitle),
        date: str(it.date),
        location: str(it.location),
        lines: bullets(it.lines, `lin_${i}_${j}`),
        bullets: bullets(it.bullets, `blt_${i}_${j}`),
      })),
    })),
    style: {
      page_size: pick(style.page_size, ['A4', 'Letter'] as const, 'A4'),
      margin_mm: num(style.margin_mm, 5, 30, 12.7),
      font: pick(style.font, Object.keys(FONT_STACKS), 'arial'),
      font_size_pt: num(style.font_size_pt, 7, 13, 10),
      line_height: num(style.line_height, 1, 2, 1.3),
      accent_color: /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(accent) ? accent : '#111111',
      heading_style: pick(style.heading_style, ['rule', 'plain'] as const, 'rule'),
      name_align: pick(style.name_align, ['left', 'center'] as const, 'left'),
      text_align: pick(style.text_align, ['left', 'justify'] as const, 'left'),
      bullet_period: pick(style.bullet_period, ['keep', 'add', 'remove'] as const, 'keep'),
    },
  }
}

/* ---------- normalisation shared by every format (common.py) ---------- */

export function applyPeriod(raw: string, policy: Style['bullet_period']): string {
  const text = raw.trim()
  if (!text || policy === 'keep') return text
  if (policy === 'add') return '.!?:;'.includes(text[text.length - 1]) ? text : `${text}.`
  if (text.endsWith('.') && !text.endsWith('..')) return text.slice(0, -1).trimEnd()
  return text
}

const drawnBullets = (list: Bullet[], policy: Style['bullet_period']): Bullet[] =>
  list.flatMap((b) => {
    const text = applyPeriod(b.text.replace(/\s+/g, ' '), policy)
    return text ? [{ id: b.id, text }] : []
  })

/** The CV exactly as it should be drawn: hidden sections and empty entries dropped, bullet period
 * policy applied. */
function prepared(cv: CV): CV {
  const policy = cv.style.bullet_period
  const hasContent = (i: Item) => i.title || i.subtitle || i.date || i.location || i.lines.length || i.bullets.length
  return {
    ...cv,
    header: { ...cv.header, contacts: cv.header.contacts.filter((c) => c.text.trim()) },
    sections: cv.sections
      .filter((s) => s.visible)
      .map((s) => ({
        ...s,
        bullets: drawnBullets(s.bullets, policy),
        items: s.items
          .map((i) => ({ ...i, bullets: drawnBullets(i.bullets, policy), lines: drawnBullets(i.lines, 'keep') }))
          .filter(hasContent),
      })),
  }
}

const safeUrl = (url: string | null | undefined): string | null =>
  url && /^(https?:\/\/|mailto:|tel:)/i.test(url.trim()) ? url.trim() : null

const displayUrl = (url: string | null): string => (url ?? '').replace(/^(https?:\/\/|mailto:)/i, '').replace(/\/+$/, '')

export function exportBasename(cv: CV, requested?: string | null): string {
  let base = requested || (cv.header.name.trim() ? `CV_${cv.header.name}` : 'CV')
  base = base.trim().replace(/\.(pdf|docx|html?)$/i, '')
  base = base.replace(/[^\w\- ]+/g, '').trim().replaceAll(' ', '_')
  return base.slice(0, 80) || 'CV'
}

/* ---------- the document (cv.html.j2) ---------- */

const ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&#34;', "'": '&#39;' }
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESCAPES[c])

const ul = (list: Bullet[], indent: string) =>
  list.length
    ? `\n${indent}<ul class="bullets">${list.map((b) => `<li data-id="${esc(b.id)}">${esc(b.text)}</li>`).join('')}</ul>`
    : ''

function contact(c: Contact): string {
  const url = safeUrl(c.url)
  const inner = url ? `<a href="${esc(url)}">${esc(c.text)}</a>` : esc(c.text)
  return `<span class="contact" data-id="${esc(c.id)}">${inner}</span>`
}

function item(i: Item): string {
  let out = `\n    <div class="item" data-id="${esc(i.id)}">`
  if (i.title || i.date) {
    const date = i.date ? `<span class="right date">${esc(i.date)}</span>` : ''
    out += `\n      <div class="row"><span class="title">${esc(i.title)}</span>${date}</div>`
  }
  if (i.subtitle || i.location) {
    const location = i.location ? `<span class="right location">${esc(i.location)}</span>` : ''
    out += `\n      <div class="row"><span class="subtitle">${esc(i.subtitle)}</span>${location}</div>`
  }
  out += i.lines.map((l) => `\n      <p class="line" data-id="${esc(l.id)}">${esc(l.text)}</p>`).join('')
  return `${out}${ul(i.bullets, '      ')}\n    </div>`
}

function section(s: Section): string {
  const titled = s.show_title && s.title
  let out = `\n  <section class="section${titled ? '' : ' untitled'}" data-id="${esc(s.id)}" data-type="${esc(s.type)}">`
  if (titled) {
    const url = safeUrl(s.title_url)
    const link = url ? ` <a href="${esc(url)}">[ ${esc(displayUrl(s.title_url))} ]</a>` : ''
    out += `\n    <h2 class="section-title">${esc(s.title)}${link}</h2>`
  }
  if (s.text) out += `\n    <p class="text">${esc(s.text)}</p>`
  out += ul(s.bullets, '    ')
  return `${out}${s.items.map(item).join('')}\n  </section>`
}

function header(cv: CV): string {
  const { name, headline, contacts } = cv.header
  let out = '\n  <header class="cv-header" data-id="header">'
  if (name) out += `\n    <h1 class="name">${esc(name)}</h1>`
  if (headline) out += `\n    <p class="headline">${esc(headline)}</p>`
  if (contacts.length) out += `\n    <p class="contacts">${contacts.map(contact).join('<span class="sep"> | </span>')}</p>`
  return `${out}\n  </header>`
}

/** One self-contained HTML document, the same markup the backend turns into the PDF. */
export function renderHtml(input: CV): string {
  const cv = prepared(withDefaults(input))
  const s = cv.style
  const [pageW, pageH] = PAGE_SIZES_MM[s.page_size]
  const rule = s.heading_style === 'rule' ? `\n  padding-bottom: 0.2rem;\n  border-bottom: 0.75pt solid ${s.accent_color};` : ''
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(cv.header.name || 'CV')}</title>
<style>
@page { size: ${pageW}mm ${pageH}mm; margin: ${s.margin_mm}mm; }
* { box-sizing: border-box; }
html { font-size: ${s.font_size_pt}pt; }
body {
  margin: 0;
  font-family: ${FONT_STACKS[s.font]};
  font-size: 1rem;
  line-height: ${s.line_height};
  color: #111;
  overflow-wrap: break-word;
  text-align: ${s.text_align};
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}
h1, h2, p, ul { margin: 0; padding: 0; }
a { color: inherit; text-decoration: none; }

.cv-header { text-align: ${s.name_align}; }
.name { font-size: 2rem; line-height: 1.15; font-weight: 700; color: ${s.accent_color}; margin-bottom: 0.35rem; }
.headline { font-weight: 700; }
.contacts .sep { padding: 0 0.15em; }
/* A contact wraps to the next line as a whole instead of breaking in the middle. */
.contacts .contact { display: inline-block; }

.section { margin-top: 1.1rem; }
.section.untitled { margin-top: 0.9rem; }
.section-title {
  font-size: 1.25rem;
  line-height: 1.2;
  font-weight: 700;
  color: ${s.accent_color};
  margin-bottom: 0.6rem;
  break-after: avoid;${rule}
}
.section-title a { font-weight: 400; font-size: 1rem; }
.text { white-space: pre-line; }

.item { margin-top: 0.6rem; }
.item:first-child, .section-title + .item { margin-top: 0; }
.row { display: flex; justify-content: space-between; align-items: baseline; gap: 1.5rem; break-after: avoid; }
.row { text-align: left; }
.row .right { flex: none; white-space: nowrap; text-align: right; }
.title { font-weight: 700; }
.line { break-inside: avoid; }

/* Real list markup: the glyph sits in the gutter and wrapped lines hang under the text. */
.bullets { list-style: disc outside; padding-left: 2.6rem; }
.bullets li { padding-left: 0.2rem; break-inside: avoid; }
.section > .bullets { margin-top: 0; }
p, li { orphans: 2; widows: 2; }

@media screen {
  html { background: transparent; }
  .page {
    width: ${pageW}mm;
    min-height: ${pageH}mm;
    margin: 0 auto;
    padding: ${s.margin_mm}mm;
    background: #fff;
  }
}
</style>
</head>
<body>
<main class="page">${header(cv)}${cv.sections.map(section).join('')}
</main>
</body>
</html>
`
}
