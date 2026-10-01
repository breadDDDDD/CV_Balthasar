import { useCallback, useEffect, useReducer, useRef } from 'react'
import type { Bullet, CV, Edit, Item, Section, SectionType } from './types'

const STORAGE_KEY = 'balthasar.cv'
const HISTORY_LIMIT = 100
// Edits to the same field within this window collapse into one undo step.
const COALESCE_MS = 900

export const uid = (prefix = 'ui') => `${prefix}_${Math.random().toString(36).slice(2, 10)}`

interface State {
  cv: CV | null
  past: CV[]
  future: CV[]
}

type Action =
  | { type: 'load'; cv: CV | null }
  | { type: 'commit'; cv: CV; coalesce: boolean }
  | { type: 'undo' }
  | { type: 'redo' }

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'load':
      return { cv: action.cv, past: [], future: [] }
    case 'commit': {
      if (!state.cv) return state
      const past = action.coalesce ? state.past : [...state.past, state.cv].slice(-HISTORY_LIMIT)
      return { cv: action.cv, past, future: [] }
    }
    case 'undo': {
      if (!state.cv || state.past.length === 0) return state
      const previous = state.past[state.past.length - 1]
      return { cv: previous, past: state.past.slice(0, -1), future: [state.cv, ...state.future] }
    }
    case 'redo': {
      if (!state.cv || state.future.length === 0) return state
      const [next, ...rest] = state.future
      return { cv: next, past: [...state.past, state.cv], future: rest }
    }
  }
}

function readStored(): CV | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY)
    return raw ? (JSON.parse(raw) as CV) : null
  } catch {
    return null
  }
}

export type Update = (fn: (cv: CV) => CV, coalesceKey?: string) => void

export function useCvStore() {
  const [state, dispatch] = useReducer(reducer, undefined, () => ({
    cv: readStored(),
    past: [],
    future: [],
  }))
  const last = useRef({ key: '', at: 0 })
  const cvRef = useRef(state.cv)
  useEffect(() => {
    cvRef.current = state.cv
  }, [state.cv])

  // The CV lives only in this tab: sessionStorage survives a refresh and is
  // gone when the tab closes. Nothing is kept on the server.
  useEffect(() => {
    try {
      if (state.cv) sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state.cv))
      else sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* storage unavailable: editing still works */
    }
  }, [state.cv])

  const update = useCallback<Update>((fn, coalesceKey) => {
    const current = cvRef.current
    if (!current) return
    const now = Date.now()
    const coalesce =
      !!coalesceKey && last.current.key === coalesceKey && now - last.current.at < COALESCE_MS
    last.current = { key: coalesceKey ?? '', at: now }
    const next = fn(current)
    if (next === current) return
    cvRef.current = next
    dispatch({ type: 'commit', cv: next, coalesce })
  }, [])

  const load = useCallback((cv: CV | null) => {
    last.current = { key: '', at: 0 }
    cvRef.current = cv
    dispatch({ type: 'load', cv })
  }, [])
  const undo = useCallback(() => {
    last.current = { key: '', at: 0 }
    dispatch({ type: 'undo' })
  }, [])
  const redo = useCallback(() => {
    last.current = { key: '', at: 0 }
    dispatch({ type: 'redo' })
  }, [])

  return {
    cv: state.cv,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
    update,
    load,
    undo,
    redo,
  }
}

/* ---------- immutable helpers ---------- */

export const mapSection = (cv: CV, id: string, fn: (s: Section) => Section): CV => ({
  ...cv,
  sections: cv.sections.map((s) => (s.id === id ? fn(s) : s)),
})

export const mapItem = (cv: CV, sectionId: string, itemId: string, fn: (i: Item) => Item): CV =>
  mapSection(cv, sectionId, (s) => ({
    ...s,
    items: s.items.map((i) => (i.id === itemId ? fn(i) : i)),
  }))

export const newBullet = (text = ''): Bullet => ({ id: uid('blt'), text })

export const newItem = (): Item => ({
  id: uid('itm'),
  title: '',
  subtitle: '',
  date: '',
  location: '',
  lines: [],
  bullets: [],
})

export const SECTION_LABELS: Record<SectionType, string> = {
  summary: 'Summary',
  experience: 'Experience',
  education: 'Education',
  projects: 'Projects',
  skills: 'Skills',
  certifications: 'Certifications',
  organizations: 'Organizations',
  volunteer: 'Volunteering',
  awards: 'Awards',
  languages: 'Languages',
  publications: 'Publications',
  custom: 'Custom section',
}

// Section kinds that are a paragraph or a flat list rather than dated entries.
const FLAT_TYPES: SectionType[] = ['summary', 'skills', 'languages']

export const newSection = (type: SectionType): Section => ({
  id: uid('sec'),
  type,
  title: type === 'custom' ? 'New section' : SECTION_LABELS[type],
  title_url: null,
  show_title: true,
  visible: true,
  text: '',
  bullets: [],
  items: FLAT_TYPES.includes(type) ? [] : [newItem()],
})

/** Used only when the backend's own blank CV could not be fetched. */
export const fallbackBlankCv = (): CV => ({
  version: 1,
  header: { name: '', headline: '', contacts: [] },
  sections: [newSection('summary'), newSection('experience'), newSection('education')],
  style: {
    page_size: 'A4',
    margin_mm: 12.7,
    font: 'arial',
    font_size_pt: 10,
    line_height: 1.3,
    accent_color: '#111111',
    heading_style: 'rule',
    name_align: 'left',
    bullet_period: 'keep',
    text_align: 'left',
  },
})

/* ---------- assistant edits ---------- */

const mapList = (list: Bullet[], id: string, fn: (b: Bullet) => Bullet | null): Bullet[] =>
  list.some((b) => b.id === id)
    ? list.flatMap((b) => {
        if (b.id !== id) return [b]
        const next = fn(b)
        return next ? [next] : []
      })
    : list

/** Current value an edit would replace, or null when the target no longer exists. */
export function currentValue(cv: CV, edit: Edit): string | null {
  const { target_id: id, field, op } = edit
  if (id === 'header') {
    return field === 'name' ? cv.header.name : field === 'headline' ? cv.header.headline : null
  }
  for (const s of cv.sections) {
    if (s.id === id) {
      if (op === 'add_bullet') return ''
      return field === 'title' ? s.title : field === 'text' ? s.text : null
    }
    const sb = s.bullets.find((b) => b.id === id)
    if (sb) return sb.text
    for (const i of s.items) {
      if (i.id === id) {
        if (op === 'add_bullet') return ''
        if (field === 'title' || field === 'subtitle' || field === 'date' || field === 'location')
          return i[field]
        return null
      }
      const b = i.bullets.find((x) => x.id === id) ?? i.lines.find((x) => x.id === id)
      if (b) return b.text
    }
  }
  return null
}

/** Applies one proposed edit. Returns the same CV object when nothing matched. */
export function applyEdit(cv: CV, edit: Edit): CV {
  const { target_id: id, field, op, after } = edit
  if (currentValue(cv, edit) === null) return cv

  if (id === 'header') {
    return { ...cv, header: { ...cv.header, [field]: after } }
  }
  const onBullet = (b: Bullet) => (op === 'remove' ? null : { ...b, text: after })

  return {
    ...cv,
    sections: cv.sections.map((s) => {
      if (s.id === id) {
        if (op === 'add_bullet') return { ...s, bullets: [...s.bullets, newBullet(after)] }
        return { ...s, [field]: after }
      }
      return {
        ...s,
        bullets: mapList(s.bullets, id, onBullet),
        items: s.items.map((i) => {
          if (i.id === id) {
            if (op === 'add_bullet') return { ...i, bullets: [...i.bullets, newBullet(after)] }
            return { ...i, [field]: after }
          }
          return {
            ...i,
            bullets: mapList(i.bullets, id, onBullet),
            lines: mapList(i.lines, id, onBullet),
          }
        }),
      }
    }),
  }
}
