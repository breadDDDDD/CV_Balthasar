import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Download, FolderOpen, Redo2, Undo2, X } from 'lucide-react'
import type { ChatTarget, ExportFormat, Meta, SectionType } from './types'
import { SECTION_LABELS, fallbackBlankCv, useCvStore } from './store'
import { ApiError, exportCv, getMeta, parseFile, parseText, saveBlob } from './api'
import { Editor } from './components/Editor'
import { Preview } from './components/Preview'
import { Chat } from './components/Chat'
import { Landing } from './components/Landing'

const DEFAULT_IMPORT = ['pdf', 'docx', 'txt', 'md', 'rtf', 'odt']
const DEFAULT_EXPORT: ExportFormat[] = ['pdf', 'docx', 'html']
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024
const FORMAT_NAMES: Record<ExportFormat, string> = { pdf: 'PDF', docx: 'Word (.docx)', html: 'Web page (.html)' }

const message = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback)

export default function App() {
  const { cv, update, load, undo, redo, canUndo, canRedo } = useCvStore()
  const [meta, setMeta] = useState<Meta | null>(null)
  const [busy, setBusy] = useState(false)
  const [landingError, setLandingError] = useState<string | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [rawText, setRawText] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [chatOpen, setChatOpen] = useState(false)
  const [target, setTarget] = useState<ChatTarget | null>(null)
  const [activeId, setActiveId] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState<ExportFormat | null>(null)
  const [pane, setPane] = useState<'edit' | 'preview'>('edit')
  const exportRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    getMeta().then(setMeta, () => setMeta(null))
  }, [])

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => setToast(null), 6000)
    return () => clearTimeout(t)
  }, [toast])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || !cv) return
      const key = e.key.toLowerCase()
      if (key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if ((key === 'z' && e.shiftKey) || key === 'y') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [cv, undo, redo])

  useEffect(() => {
    if (!exportOpen) return
    const close = (e: PointerEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [exportOpen])

  const maxBytes = meta?.max_upload_bytes ?? DEFAULT_MAX_BYTES

  async function openFile(file: File) {
    const report = cv ? setToast : setLandingError
    if (file.size > maxBytes) {
      report(`That file is ${(file.size / 1048576).toFixed(1)} MB. The limit is ${Math.round(maxBytes / 1048576)} MB.`)
      return
    }
    setBusy(true)
    setLandingError(null)
    try {
      const result = await parseFile(file)
      // Replacing an open CV goes through history, so Undo brings the old one back.
      if (cv) update(() => result.cv)
      else load(result.cv)
      setWarnings(result.warnings)
      setRawText(result.raw_text)
    } catch (err) {
      report(message(err, 'That file could not be read.'))
    } finally {
      setBusy(false)
    }
  }

  // Explicit, user-pressed only: this spends one Gemini call.
  async function reparseWithAi() {
    if (!rawText) return
    setBusy(true)
    try {
      const result = await parseText(rawText, true)
      update(() => result.cv)
      setWarnings(result.warnings)
    } catch (err) {
      setToast(message(err, 'The AI could not re-read the file.'))
    } finally {
      setBusy(false)
    }
  }

  async function download(format: ExportFormat) {
    if (!cv) return
    setExportOpen(false)
    setExporting(format)
    try {
      const { blob, filename } = await exportCv(cv, format)
      saveBlob(blob, filename)
    } catch (err) {
      setToast(message(err, 'The download could not be made.'))
    } finally {
      setExporting(null)
    }
  }

  const focusInEditor = useCallback((id: string) => {
    setActiveId(id)
    setPane('edit')
    const el = document.querySelector<HTMLElement>(`[data-cv-id="${CSS.escape(id)}"]`)
    if (!el) return
    el.scrollIntoView({ block: 'center', behavior: 'smooth' })
    el.classList.remove('is-flash')
    void el.offsetWidth
    el.classList.add('is-flash')
  }, [])

  const sectionTypes = meta?.section_types ?? (Object.keys(SECTION_LABELS) as SectionType[])
  const formats = meta?.export_formats ?? DEFAULT_EXPORT

  if (!cv) {
    return (
      <AnimatePresence mode="wait">
        <Landing
          key="landing"
          busy={busy}
          error={landingError}
          formats={meta?.import_formats ?? DEFAULT_IMPORT}
          maxBytes={maxBytes}
          onFile={openFile}
          onBlank={() => load(meta?.blank_cv ?? fallbackBlankCv())}
        />
      </AnimatePresence>
    )
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key="app"
        className={`app ${chatOpen ? 'app--chat' : ''}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35, ease: 'easeOut' }}
      >
      <header className="topbar">
        <p className="brand">Balthasar</p>
        <div className="topbar__group">
          <button type="button" className="icon-btn" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo">
            <Undo2 size={17} />
          </button>
          <button type="button" className="icon-btn" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Shift+Z)" aria-label="Redo">
            <Redo2 size={17} />
          </button>
        </div>
        <div className="pane-switch" role="group" aria-label="Show">
          <button type="button" className={pane === 'edit' ? 'is-on' : ''} onClick={() => setPane('edit')}>
            Edit
          </button>
          <button type="button" className={pane === 'preview' ? 'is-on' : ''} onClick={() => setPane('preview')}>
            Preview
          </button>
        </div>
        <div className="topbar__group topbar__group--end">
          <button type="button" className="btn btn--quiet" disabled={busy} onClick={() => fileRef.current?.click()}>
            <FolderOpen size={16} /> <span>{busy ? 'Reading' : 'Open another CV'}</span>
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            accept={(meta?.import_formats ?? DEFAULT_IMPORT).map((f) => `.${f}`).join(',')}
            onChange={(e) => {
              const file = e.target.files?.[0]
              if (file) openFile(file)
              e.target.value = ''
            }}
          />
          <div className="popover-anchor" ref={exportRef}>
            <button
              type="button"
              className="btn btn--primary"
              aria-expanded={exportOpen}
              disabled={exporting !== null}
              onClick={() => setExportOpen((o) => !o)}
            >
              <Download size={16} /> <span>{exporting ? `Making ${exporting.toUpperCase()}` : 'Download'}</span>
            </button>
            <AnimatePresence>
              {exportOpen && (
                <motion.div
                  className="menu menu--down"
                  role="menu"
                  initial={{ opacity: 0, scale: 0.95, y: -6 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.95, y: -6 }}
                  transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
                >
                  {formats.map((f) => (
                    <button
                      key={f}
                      type="button"
                      role="menuitem"
                      className="menu__item"
                      disabled={f === 'pdf' && meta?.pdf_available === false}
                      onClick={() => download(f)}
                    >
                      {FORMAT_NAMES[f] ?? f}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
      </header>

      <main className={`workspace workspace--${pane}`}>
        <div
          className="pane pane--editor"
          onFocusCapture={(e) => {
            const id = (e.target as HTMLElement).closest<HTMLElement>('[data-cv-id]')?.dataset.cvId
            if (id) setActiveId(id)
          }}
        >
          {warnings.length > 0 && (
            <div className="notice" role="status">
              <div>
                <p className="notice__title">Check these after import</p>
                <ul>
                  {warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
                {rawText && meta?.ai_enabled && (
                  <button type="button" className="link-btn" disabled={busy} onClick={reparseWithAi}>
                    {busy ? 'Re-reading' : 'Re-read the file with AI (uses one Gemini call)'}
                  </button>
                )}
              </div>
              <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setWarnings([])}>
                <X size={16} />
              </button>
            </div>
          )}
          <Editor
            cv={cv}
            update={update}
            sectionTypes={sectionTypes}
            onAsk={(t) => {
              setTarget(t)
              setChatOpen(true)
            }}
          />
        </div>
        <div className="pane pane--preview">
          <Preview cv={cv} update={update} activeId={activeId} meta={meta} />
        </div>
      </main>

      <Chat
        cv={cv}
        update={update}
        meta={meta}
        open={chatOpen}
        onOpenChange={setChatOpen}
        target={target}
        onClearTarget={() => setTarget(null)}
        onFocus={focusInEditor}
      />

      <AnimatePresence>
        {toast && (
          <motion.div
            className="toast"
            role="alert"
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.3 }}
          >
            <span>{toast}</span>
            <button type="button" className="icon-btn" aria-label="Dismiss" onClick={() => setToast(null)}>
              <X size={15} />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      </motion.div>
    </AnimatePresence>
  )
}
