import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, Reorder, motion, useDragControls } from 'motion/react'
import { ChevronDown, Eye, EyeOff, GripVertical, Heading, Plus, Sparkles, Trash2, X } from 'lucide-react'
import type { Bullet, CV, ChatTarget, Contact, Item, Section, SectionType } from '../types'
import {
  SECTION_LABELS,
  mapItem,
  mapSection,
  newBullet,
  newItem,
  newSection,
  uid,
  type Update,
} from '../store'

const SPRING = { type: 'spring', bounce: 0, duration: 0.4 } as const

interface FieldProps {
  value: string
  onChange: (value: string) => void
  placeholder: string
  label: string
  className?: string
}

/** A textarea that grows with its content, so no field ever scrolls internally. */
function Field({ value, onChange, placeholder, label, className = '' }: FieldProps) {
  const ref = useRef<HTMLTextAreaElement>(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [value])
  // Text re-wraps when the pane changes width (assistant opening, window resize).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let width = el.clientWidth
    const observer = new ResizeObserver(() => {
      if (el.clientWidth === width) return
      width = el.clientWidth
      el.style.height = 'auto'
      el.style.height = `${el.scrollHeight}px`
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  return (
    <textarea
      ref={ref}
      className={`field ${className}`}
      rows={1}
      value={value}
      aria-label={label}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

/** Moves the entry with this id one place up or down. Returns the same list at either end. */
function moveBy<T extends { id: string }>(list: T[], id: string, delta: number): T[] {
  const from = list.findIndex((x) => x.id === id)
  const to = from + delta
  if (from < 0 || to < 0 || to >= list.length) return list
  const next = [...list]
  next.splice(to, 0, next.splice(from, 1)[0])
  return next
}

function Handle({
  controls,
  label,
  onMove,
}: {
  controls: ReturnType<typeof useDragControls>
  label: string
  onMove: (delta: number) => void
}) {
  return (
    <button
      type="button"
      className="handle"
      aria-label={`${label}. Arrow keys also move it`}
      title={`${label}, or focus and press the arrow keys`}
      onPointerDown={(e) => {
        e.preventDefault()
        controls.start(e)
      }}
      onKeyDown={(e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
        e.preventDefault()
        onMove(e.key === 'ArrowUp' ? -1 : 1)
      }}
    >
      <GripVertical size={16} />
    </button>
  )
}

interface Ctx {
  update: Update
  onAsk: (target: ChatTarget) => void
}

function BulletRow({
  bullet,
  plain,
  onText,
  onMove,
  onRemove,
  onAsk,
}: {
  bullet: Bullet
  plain?: boolean
  onText: (text: string) => void
  onMove: (delta: number) => void
  onRemove: () => void
  onAsk: Ctx['onAsk']
}) {
  const controls = useDragControls()
  return (
    <Reorder.Item
      value={bullet}
      initial={{ opacity: 0, scale: 0.96, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className={`bullet ${plain ? 'bullet--plain' : ''}`}
      data-cv-id={bullet.id}
      dragListener={false}
      dragControls={controls}
      transition={SPRING}
      whileDrag={{ scale: 1.015, zIndex: 3 }}
    >
      <Handle controls={controls} label="Drag to reorder" onMove={onMove} />
      <Field
        value={bullet.text}
        onChange={onText}
        placeholder={plain ? 'A plain line, such as GPA : 3.5/4' : 'What you did, how, and the result'}
        label={plain ? 'Line' : 'Bullet'}
      />
      <div className="row-actions">
        {!plain && (
          <button
            type="button"
            className="icon-btn icon-btn--accent"
            title="Ask Biel to improve this bullet"
            aria-label="Ask Biel to improve this bullet"
            onClick={() => onAsk({ id: bullet.id, label: bullet.text.slice(0, 70) || 'this bullet' })}
          >
            <Sparkles size={15} />
          </button>
        )}
        <button type="button" className="icon-btn" title="Delete" aria-label="Delete" onClick={onRemove}>
          <X size={15} />
        </button>
      </div>
    </Reorder.Item>
  )
}

/** A reorderable list of bullets or plain lines. `onChange` receives the whole new list. */
function BulletList({
  list,
  plain,
  keyPrefix,
  onChange,
  onAsk,
}: {
  list: Bullet[]
  plain?: boolean
  keyPrefix: string
  onChange: (list: Bullet[], coalesceKey?: string) => void
  onAsk: Ctx['onAsk']
}) {
  if (list.length === 0) return null
  return (
    <Reorder.Group axis="y" as="ul" className="bullets" values={list} onReorder={(next: Bullet[]) => onChange(next)}>
      <AnimatePresence initial={false}>
      {list.map((b) => (
        <BulletRow
          key={b.id}
          bullet={b}
          plain={plain}
          onAsk={onAsk}
          onText={(text) =>
            onChange(
              list.map((x) => (x.id === b.id ? { ...x, text } : x)),
              `${keyPrefix}:${b.id}`,
            )
          }
          onMove={(delta) => onChange(moveBy(list, b.id, delta))}
          onRemove={() => onChange(list.filter((x) => x.id !== b.id))}
        />
      ))}
      </AnimatePresence>
    </Reorder.Group>
  )
}

function ItemCard({ item, section, update, onAsk }: { item: Item; section: Section } & Ctx) {
  const controls = useDragControls()
  const set = (patch: Partial<Item>, key?: string) =>
    update((cv) => mapItem(cv, section.id, item.id, (i) => ({ ...i, ...patch })), key && `${key}:${item.id}`)
  const remove = () =>
    update((cv) => mapSection(cv, section.id, (s) => ({ ...s, items: s.items.filter((i) => i.id !== item.id) })))

  return (
    <Reorder.Item
      as="div"
      value={item}
      initial={{ opacity: 0, scale: 0.96, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className="item"
      data-cv-id={item.id}
      dragListener={false}
      dragControls={controls}
      transition={SPRING}
      whileDrag={{ scale: 1.01, zIndex: 3 }}
    >
      <div className="item__head">
        <Handle
          controls={controls}
          label="Drag to reorder entry"
          onMove={(delta) =>
            update((cv) => mapSection(cv, section.id, (s) => ({ ...s, items: moveBy(s.items, item.id, delta) })))
          }
        />
        <div className="item__grid">
          <Field
            className="field--strong"
            value={item.title}
            onChange={(title) => set({ title }, 'title')}
            placeholder="Company, school or project"
            label="Entry title"
          />
          <Field
            className="field--right"
            value={item.date}
            onChange={(date) => set({ date }, 'date')}
            placeholder="Dates"
            label="Dates"
          />
          <Field
            value={item.subtitle}
            onChange={(subtitle) => set({ subtitle }, 'subtitle')}
            placeholder="Role or degree"
            label="Role or degree"
          />
          <Field
            className="field--right"
            value={item.location}
            onChange={(location) => set({ location }, 'location')}
            placeholder="Location"
            label="Location"
          />
        </div>
        <div className="row-actions">
          <button
            type="button"
            className="icon-btn icon-btn--accent"
            title="Ask Biel to review this entry"
            aria-label="Ask Biel to review this entry"
            onClick={() => onAsk({ id: item.id, label: item.title || section.title })}
          >
            <Sparkles size={15} />
          </button>
          <button type="button" className="icon-btn" title="Delete entry" aria-label="Delete entry" onClick={remove}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="item__body">
        <BulletList
          plain
          list={item.lines}
          keyPrefix="line"
          onAsk={onAsk}
          onChange={(lines, key) => set({ lines }, key)}
        />
        <BulletList
          list={item.bullets}
          keyPrefix="bullet"
          onAsk={onAsk}
          onChange={(bullets, key) => set({ bullets }, key)}
        />
        <div className="add-row">
          <button type="button" className="ghost-btn" onClick={() => set({ bullets: [...item.bullets, newBullet()] })}>
            <Plus size={14} /> Add bullet
          </button>
          <button type="button" className="ghost-btn" onClick={() => set({ lines: [...item.lines, newBullet()] })}>
            <Plus size={14} /> Add plain line
          </button>
        </div>
      </div>
    </Reorder.Item>
  )
}

function SectionCard({ section, update, onAsk }: { section: Section } & Ctx) {
  const controls = useDragControls()
  const [open, setOpen] = useState(true)
  const patch = (p: Partial<Section>, key?: string) =>
    update((cv) => mapSection(cv, section.id, (s) => ({ ...s, ...p })), key && `${key}:${section.id}`)
  const parts = [
    section.items.length && `${section.items.length} ${section.items.length === 1 ? 'entry' : 'entries'}`,
    section.bullets.length && `${section.bullets.length} ${section.bullets.length === 1 ? 'bullet' : 'bullets'}`,
  ].filter(Boolean)

  return (
    <Reorder.Item
      as="div"
      value={section}
      initial={{ opacity: 0, scale: 0.96, y: -8 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.96 }}
      className={`section ${section.visible ? '' : 'section--hidden'}`}
      data-cv-id={section.id}
      dragListener={false}
      dragControls={controls}
      transition={SPRING}
      whileDrag={{ scale: 1.012, zIndex: 5, boxShadow: '0 28px 60px -18px rgba(3, 9, 34, 0.9)' }}
    >
      <header className="section__head">
        <Handle
          controls={controls}
          label="Drag to reorder section"
          onMove={(delta) => update((cv) => ({ ...cv, sections: moveBy(cv.sections, section.id, delta) }))}
        />
        <input
          className="section__title"
          value={section.title}
          aria-label="Section title"
          placeholder="Section title"
          onChange={(e) => patch({ title: e.target.value }, 'stitle')}
        />
        <span className="section__count">{section.visible ? parts.join(', ') : 'Hidden from CV'}</span>
        <div className="row-actions row-actions--always">
          <button
            type="button"
            className="icon-btn icon-btn--accent"
            title="Ask Biel to review this section"
            aria-label="Ask Biel to review this section"
            onClick={() => onAsk({ id: section.id, label: section.title || 'this section' })}
          >
            <Sparkles size={16} />
          </button>
          <button
            type="button"
            className={`icon-btn ${section.show_title ? '' : 'icon-btn--off'}`}
            title={section.show_title ? 'Heading is printed. Click to print without it' : 'Heading is not printed. Click to print it'}
            aria-label="Print the section heading"
            aria-pressed={section.show_title}
            onClick={() => patch({ show_title: !section.show_title })}
          >
            <Heading size={16} />
          </button>
          <button
            type="button"
            className="icon-btn"
            title={section.visible ? 'Hide from CV' : 'Show in CV'}
            aria-label={section.visible ? 'Hide section from CV' : 'Show section in CV'}
            onClick={() => patch({ visible: !section.visible })}
          >
            {section.visible ? <Eye size={16} /> : <EyeOff size={16} />}
          </button>
          <button
            type="button"
            className="icon-btn"
            title="Delete section"
            aria-label="Delete section"
            onClick={() => update((cv) => ({ ...cv, sections: cv.sections.filter((s) => s.id !== section.id) }))}
          >
            <Trash2 size={16} />
          </button>
          <button
            type="button"
            className={`icon-btn chevron ${open ? 'chevron--open' : ''}`}
            aria-expanded={open}
            aria-label={open ? 'Collapse section' : 'Expand section'}
            onClick={() => setOpen((o) => !o)}
          >
            <ChevronDown size={17} />
          </button>
        </div>
      </header>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            className="section__body"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={SPRING}
          >
            <div className="section__inner">
              {(section.text || section.type === 'summary' || section.items.length === 0) && (
                <Field
                  className="field--para"
                  value={section.text}
                  onChange={(text) => patch({ text }, 'stext')}
                  placeholder="Paragraph (optional)"
                  label="Section paragraph"
                />
              )}
              {(section.title_url !== null || section.type === 'projects') && (
                <Field
                  value={section.title_url ?? ''}
                  onChange={(url) => patch({ title_url: url.trim() || null }, 'surl')}
                  placeholder="Link shown beside the heading (optional)"
                  label="Link beside the heading"
                />
              )}
              <BulletList
                list={section.bullets}
                keyPrefix="sbullet"
                onAsk={onAsk}
                onChange={(bullets, key) => patch({ bullets }, key)}
              />
              <Reorder.Group
                axis="y"
                as="div"
                className="items"
                values={section.items}
                onReorder={(items: Item[]) => patch({ items })}
              >
                <AnimatePresence initial={false}>
                  {section.items.map((item) => (
                    <ItemCard key={item.id} item={item} section={section} update={update} onAsk={onAsk} />
                  ))}
                </AnimatePresence>
              </Reorder.Group>
              <div className="add-row">
                <button type="button" className="ghost-btn" onClick={() => patch({ items: [...section.items, newItem()] })}>
                  <Plus size={14} /> Add entry
                </button>
                <button
                  type="button"
                  className="ghost-btn"
                  onClick={() => patch({ bullets: [...section.bullets, newBullet()] })}
                >
                  <Plus size={14} /> Add bullet
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </Reorder.Item>
  )
}

function AddSection({ update, types }: { update: Update; types: SectionType[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', close)
    return () => document.removeEventListener('pointerdown', close)
  }, [open])
  return (
    <div className="add-section" ref={ref}>
      <button type="button" className="add-section__btn" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <Plus size={16} /> Add section
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            className="menu menu--up menu--grid"
            role="menu"
            initial={{ opacity: 0, scale: 0.94, y: 6 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.94, y: 6 }}
            transition={{ type: 'spring', bounce: 0, duration: 0.25 }}
          >
            {types.map((type) => (
              <button
                key={type}
                type="button"
                role="menuitem"
                className="menu__item"
                onClick={() => {
                  update((cv) => ({ ...cv, sections: [...cv.sections, newSection(type)] }))
                  setOpen(false)
                }}
              >
                {SECTION_LABELS[type] ?? type}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Keeps the link in step with the text when the text is plainly an email or a web address. */
function contactFromText(contact: Contact, text: string): Contact {
  const t = text.trim()
  let url: string | null = null
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) url = `mailto:${t}`
  else if (/^https?:\/\/\S+$/i.test(t)) url = t
  else if (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t)) url = `https://${t}`
  return { ...contact, text, url }
}

export function Editor({ cv, update, onAsk, sectionTypes }: { cv: CV; sectionTypes: SectionType[] } & Ctx) {
  const setHeader = (patch: Partial<CV['header']>, key?: string) =>
    update((c) => ({ ...c, header: { ...c.header, ...patch } }), key)
  const contacts = cv.header.contacts

  return (
    <div className="editor">
      <section className="section section--header" data-cv-id="header">
        <input
          className="name-input"
          value={cv.header.name}
          placeholder="Your name"
          aria-label="Your name"
          onChange={(e) => setHeader({ name: e.target.value }, 'name')}
        />
        <Field
          value={cv.header.headline}
          onChange={(headline) => setHeader({ headline }, 'headline')}
          placeholder="Headline under your name (optional)"
          label="Headline"
        />
        <div className="contacts">
          {contacts.map((c) => (
            <div className="contact" key={c.id}>
              <input
                className="contact__input"
                value={c.text}
                size={Math.max(8, c.text.length)}
                placeholder="Phone, email, city or link"
                aria-label="Contact detail"
                onChange={(e) =>
                  setHeader(
                    { contacts: contacts.map((x) => (x.id === c.id ? contactFromText(x, e.target.value) : x)) },
                    `contact:${c.id}`,
                  )
                }
              />
              <button
                type="button"
                className="contact__x"
                aria-label={`Delete ${c.text || 'contact detail'}`}
                onClick={() => setHeader({ contacts: contacts.filter((x) => x.id !== c.id) })}
              >
                <X size={13} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="ghost-btn"
            onClick={() => setHeader({ contacts: [...contacts, { id: uid('ctc'), kind: 'other', text: '', url: null }] })}
          >
            <Plus size={14} /> Add contact
          </button>
        </div>
      </section>

      <Reorder.Group
        axis="y"
        as="div"
        className="sections"
        values={cv.sections}
        onReorder={(sections: Section[]) => update((c) => ({ ...c, sections }))}
      >
        <AnimatePresence initial={false}>
          {cv.sections.map((s) => (
            <SectionCard key={s.id} section={s} update={update} onAsk={onAsk} />
          ))}
        </AnimatePresence>
      </Reorder.Group>

      <AddSection update={update} types={sectionTypes} />
    </div>
  )
}
