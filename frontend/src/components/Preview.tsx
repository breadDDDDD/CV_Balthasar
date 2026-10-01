import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValue, useReducedMotion, useSpring } from 'motion/react'
import { Minus, Plus, SlidersHorizontal } from 'lucide-react'
import type { CV, Meta, Style } from '../types'
import type { Update } from '../store'
import { ApiError, exportCv, renderCv } from '../api'

const PAGE_WIDTH_PX = { A4: 793.7, Letter: 816 }
const RENDER_DEBOUNCE_MS = 400
const PDF_DEBOUNCE_MS = 900
const TILT_DEG = 1.6

// Added to the backend's document so the element being edited is easy to find on the page.
const HIGHLIGHT_CSS = `
  [data-active] { background: rgba(137, 49, 114, 0.13); box-shadow: 0 0 0 3px rgba(137, 49, 114, 0.13); border-radius: 2px; }
  [data-id] { transition: background 0.25s ease, box-shadow 0.25s ease; }
  [data-new] { animation: cv-arrive 0.5s ease-out; }
  @keyframes cv-arrive { from { opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { [data-new] { animation: none; } }
`

function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T
  options: { value: T; label: string }[]
  onChange: (v: T) => void
  label: string
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={o.value === value ? 'is-on' : ''}
          aria-pressed={o.value === value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

function StylePanel({ style, fonts, update }: { style: Style; fonts: string[]; update: Update }) {
  const set = (patch: Partial<Style>, key?: string) =>
    update((cv) => ({ ...cv, style: { ...cv.style, ...patch } }), key && `style:${key}`)
  const range = (key: 'margin_mm' | 'font_size_pt' | 'line_height', min: number, max: number, step: number) => (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={style[key]}
      onChange={(e) => set({ [key]: Number(e.target.value) }, key)}
    />
  )
  return (
    <div className="style-panel">
      <label>
        <span>Margins, all four sides</span>
        <output>{style.margin_mm} mm</output>
        {range('margin_mm', 5, 30, 0.5)}
      </label>
      <label>
        <span>Text size</span>
        <output>{style.font_size_pt} pt</output>
        {range('font_size_pt', 7, 13, 0.5)}
      </label>
      <label>
        <span>Line spacing</span>
        <output>{style.line_height.toFixed(2)}</output>
        {range('line_height', 1, 2, 0.05)}
      </label>
      <label>
        <span>Font</span>
        <select value={style.font} onChange={(e) => set({ font: e.target.value })}>
          {fonts.map((f) => (
            <option key={f} value={f}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </option>
          ))}
        </select>
      </label>
      <div className="style-panel__row">
        <span>Paper</span>
        <Segmented
          label="Paper size"
          value={style.page_size}
          onChange={(page_size) => set({ page_size })}
          options={[
            { value: 'A4', label: 'A4' },
            { value: 'Letter', label: 'Letter' },
          ]}
        />
      </div>
      <div className="style-panel__row">
        <span>Period at the end of bullets</span>
        <Segmented
          label="Period at the end of bullets"
          value={style.bullet_period}
          onChange={(bullet_period) => set({ bullet_period })}
          options={[
            { value: 'keep', label: 'As typed' },
            { value: 'add', label: 'Always' },
            { value: 'remove', label: 'Never' },
          ]}
        />
      </div>
      <div className="style-panel__row">
        <span>Text edges</span>
        <Segmented
          label="Text alignment"
          value={style.text_align ?? 'left'}
          onChange={(text_align) => set({ text_align })}
          options={[
            { value: 'justify', label: 'Justified' },
            { value: 'left', label: 'Left' },
          ]}
        />
      </div>
      <div className="style-panel__row">
        <span>Section headings</span>
        <Segmented
          label="Section headings"
          value={style.heading_style}
          onChange={(heading_style) => set({ heading_style })}
          options={[
            { value: 'rule', label: 'Underlined' },
            { value: 'plain', label: 'Plain' },
          ]}
        />
      </div>
      <div className="style-panel__row">
        <span>Name</span>
        <Segmented
          label="Name alignment"
          value={style.name_align}
          onChange={(name_align) => set({ name_align })}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Centered' },
          ]}
        />
      </div>
      <label className="style-panel__row">
        <span>Heading colour</span>
        <input
          type="color"
          value={style.accent_color}
          onChange={(e) => set({ accent_color: e.target.value }, 'accent')}
        />
      </label>
    </div>
  )
}

interface Props {
  cv: CV
  update: Update
  activeId: string | null
  meta: Meta | null
}

export function Preview({ cv, update, activeId, meta }: Props) {
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const [frameReady, setFrameReady] = useState(false)
  const [html, setHtml] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState<number | null>(null)
  const [settled, setSettled] = useState<CV | null>(null)
  const busy = settled !== cv
  const [error, setError] = useState<string | null>(null)
  const [contentHeight, setContentHeight] = useState(1123)
  const [stageWidth, setStageWidth] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [mode, setMode] = useState<'live' | 'pdf'>('live')
  const [pdfUrl, setPdfUrl] = useState<string | null>(null)
  const [panelOpen, setPanelOpen] = useState(false)
  const panelRef = useRef<HTMLDivElement>(null)
  const reduceMotion = useReducedMotion()

  const pageWidth = PAGE_WIDTH_PX[cv.style.page_size] ?? PAGE_WIDTH_PX.A4
  const fit = stageWidth ? Math.min(1, (stageWidth - 72) / pageWidth) : 1
  const scale = fit * zoom

  /* ---- ask the backend for the page, debounced ---- */
  useEffect(() => {
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const result = await renderCv(cv, controller.signal)
        setHtml(result.html)
        setPageCount(result.page_count)
        setError(null)
        setSettled(cv)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'The preview could not be drawn.')
        setSettled(cv)
      }
    }, RENDER_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [cv])

  /* ---- swap the document in place, so the page never flashes blank ---- */
  useLayoutEffect(() => {
    const doc = frameRef.current?.contentDocument
    if (!frameReady || !doc || html === null) return
    const next = new DOMParser().parseFromString(html, 'text/html')
    const before = new Set(Array.from(doc.querySelectorAll('[data-id]'), (el) => el.getAttribute('data-id')))
    doc.head.innerHTML = next.head.innerHTML
    doc.body.innerHTML = next.body.innerHTML
    doc.body.className = next.body.className
    // Sections, entries and bullets that were not on the page a moment ago fade in.
    if (before.size > 0) {
      doc.querySelectorAll('[data-id]').forEach((el) => {
        if (!before.has(el.getAttribute('data-id'))) el.setAttribute('data-new', '')
      })
    }
    const style = doc.createElement('style')
    style.textContent = HIGHLIGHT_CSS
    doc.head.appendChild(style)

    const measure = () => {
      const body = doc.body
      const margin = parseFloat(doc.defaultView?.getComputedStyle(body).marginBottom ?? '0') || 0
      setContentHeight(Math.max(200, Math.ceil(body.getBoundingClientRect().bottom + margin)))
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(doc.body)
    return () => observer.disconnect()
  }, [html, frameReady])

  /* ---- highlight what is being edited and bring it into view ---- */
  useEffect(() => {
    const doc = frameRef.current?.contentDocument
    const stage = stageRef.current
    if (!doc || !stage || html === null) return
    doc.querySelectorAll('[data-active]').forEach((el) => el.removeAttribute('data-active'))
    if (!activeId || activeId === 'header') return
    const el = doc.querySelector(`[data-id="${CSS.escape(activeId)}"]`)
    if (!el) return
    el.setAttribute('data-active', '')
    const frameTop = frameRef.current!.getBoundingClientRect().top - stage.getBoundingClientRect().top + stage.scrollTop
    const rect = el.getBoundingClientRect()
    const top = frameTop + rect.top * scale
    const bottom = frameTop + rect.bottom * scale
    if (top < stage.scrollTop + 24 || bottom > stage.scrollTop + stage.clientHeight - 24) {
      stage.scrollTo({ top: Math.max(0, top - stage.clientHeight / 3), behavior: reduceMotion ? 'auto' : 'smooth' })
    }
  }, [activeId, html, scale, reduceMotion])

  useEffect(() => {
    const stage = stageRef.current
    if (!stage) return
    const observer = new ResizeObserver(() => setStageWidth(stage.clientWidth))
    observer.observe(stage)
    return () => observer.disconnect()
  }, [])

  /* ---- exact PDF view: the real export, so page breaks are the real ones ---- */
  useEffect(() => {
    if (mode !== 'pdf') return
    const controller = new AbortController()
    const timer = setTimeout(async () => {
      try {
        const { blob } = await exportCv(cv, 'pdf', controller.signal)
        setPdfUrl((old) => {
          if (old) URL.revokeObjectURL(old)
          return URL.createObjectURL(blob)
        })
        setError(null)
      } catch (err) {
        if (controller.signal.aborted) return
        setError(err instanceof ApiError ? err.message : 'The PDF could not be made.')
      }
    }, PDF_DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, [cv, mode])

  useEffect(() => {
    if (!panelOpen) return
    const close = (e: PointerEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) setPanelOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [panelOpen])

  /* ---- the sheet leans a little toward the pointer ---- */
  const rx = useSpring(useMotionValue(0), { stiffness: 140, damping: 22 })
  const ry = useSpring(useMotionValue(0), { stiffness: 140, damping: 22 })
  const origin = useMotionValue('50% 30%')
  const onPointerMove = (e: React.PointerEvent) => {
    if (reduceMotion || e.pointerType !== 'mouse') return
    const stage = stageRef.current!
    const box = stage.getBoundingClientRect()
    ry.set(((e.clientX - box.left) / box.width - 0.5) * 2 * TILT_DEG)
    rx.set(-((e.clientY - box.top) / box.height - 0.5) * 2 * TILT_DEG)
    origin.set(`50% ${stage.scrollTop + box.height / 2}px`)
  }
  const onPointerLeave = () => {
    rx.set(0)
    ry.set(0)
  }

  const status = error
    ? 'Preview paused'
    : busy
      ? 'Updating'
      : pageCount
        ? `${pageCount} ${pageCount === 1 ? 'page' : 'pages'}`
        : 'Up to date'

  return (
    <div className="preview">
      <div className="preview__bar">
        <span className={`preview__status ${busy && !error ? 'is-busy' : ''} ${error ? 'is-error' : ''}`} aria-live="polite">
          {status}
        </span>
        <div className="preview__tools">
          {meta?.pdf_available !== false && (
            <Segmented
              label="Preview type"
              value={mode}
              onChange={setMode}
              options={[
                { value: 'live', label: 'Live' },
                { value: 'pdf', label: 'Exact PDF' },
              ]}
            />
          )}
          {mode === 'live' && (
            <div className="zoom">
              <button type="button" className="icon-btn" aria-label="Zoom out" onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.1).toFixed(2)))}>
                <Minus size={15} />
              </button>
              <button type="button" className="zoom__value" title="Fit to width" onClick={() => setZoom(1)}>
                {Math.round(scale * 100)}%
              </button>
              <button type="button" className="icon-btn" aria-label="Zoom in" onClick={() => setZoom((z) => Math.min(2.5, +(z + 0.1).toFixed(2)))}>
                <Plus size={15} />
              </button>
            </div>
          )}
          <div className="popover-anchor" ref={panelRef}>
            <button type="button" className="btn btn--quiet" aria-expanded={panelOpen} onClick={() => setPanelOpen((o) => !o)}>
              <SlidersHorizontal size={15} /> Page layout
            </button>
            <AnimatePresence>
              {panelOpen && (
                <motion.div
                  className="menu menu--down menu--panel"
                  initial={{ opacity: 0, scale: 0.95, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -6 }}
                  transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
                >
                  <StylePanel style={cv.style} fonts={meta?.fonts ?? [cv.style.font]} update={update} />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </div>

      {error && (
        <p className="preview__error" role="alert">
          {error} Your edits are kept in this tab and the preview resumes on the next change.
        </p>
      )}

      <div
        className="stage"
        ref={stageRef}
        onPointerMove={onPointerMove}
        onPointerLeave={onPointerLeave}
        hidden={mode !== 'live'}
      >
        <motion.div
          className="sheet-drop"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, rotateX: 34, y: 90, scale: 0.94 }}
          animate={html !== null ? { opacity: 1, rotateX: 0, y: 0, scale: 1 } : undefined}
          transition={{ type: 'spring', bounce: 0.12, duration: 0.9 }}
        >
          <motion.div
            className="sheet"
            style={{
              width: pageWidth * scale,
              height: contentHeight * scale,
              rotateX: rx,
              rotateY: ry,
              transformOrigin: origin,
            }}
          >
            <iframe
              ref={frameRef}
              title="CV preview"
              className="sheet__frame"
              sandbox="allow-same-origin"
              tabIndex={-1}
              srcDoc="<!doctype html><html><head></head><body></body></html>"
              onLoad={() => setFrameReady(true)}
              style={{ width: pageWidth, height: contentHeight, transform: `scale(${scale})` }}
            />
          </motion.div>
        </motion.div>
      </div>

      {mode === 'pdf' && (
        <div className="pdf-view">
          {pdfUrl ? (
            <iframe title="Exact PDF preview" src={`${pdfUrl}#toolbar=0&navpanes=0&view=FitH`} />
          ) : (
            !error && <p className="pdf-view__wait">Making the PDF</p>
          )}
        </div>
      )}
    </div>
  )
}
