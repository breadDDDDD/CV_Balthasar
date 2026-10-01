// Mirrors the contract in backend/API.md (v1). The backend owns that file;
// when it changes, change these types to match rather than adapting around it.

export type SectionType =
  | 'summary'
  | 'experience'
  | 'education'
  | 'projects'
  | 'skills'
  | 'certifications'
  | 'organizations'
  | 'volunteer'
  | 'awards'
  | 'languages'
  | 'publications'
  | 'custom'

export type ContactKind = 'phone' | 'email' | 'location' | 'linkedin' | 'github' | 'website' | 'other'

export interface Contact {
  id: string
  kind: ContactKind
  text: string
  url?: string | null
}

export interface Bullet {
  id: string
  text: string
}

export interface Item {
  id: string
  title: string
  subtitle: string
  date: string
  location: string
  lines: Bullet[]
  bullets: Bullet[]
}

export interface Section {
  id: string
  type: SectionType
  title: string
  title_url: string | null
  show_title: boolean
  visible: boolean
  text: string
  bullets: Bullet[]
  items: Item[]
}

export interface Style {
  page_size: 'A4' | 'Letter'
  margin_mm: number
  font: string
  font_size_pt: number
  line_height: number
  accent_color: string
  heading_style: 'rule' | 'plain'
  name_align: 'left' | 'center'
  bullet_period: 'keep' | 'add' | 'remove'
  text_align: 'left' | 'justify'
}

export interface CV {
  version: number
  header: { name: string; headline: string; contacts: Contact[] }
  sections: Section[]
  style: Style
}

export interface Meta {
  import_formats: string[]
  export_formats: ExportFormat[]
  max_upload_bytes: number
  ai_enabled: boolean
  ai_mock: boolean
  pdf_available: boolean
  section_types: SectionType[]
  fonts: string[]
  blank_cv: CV
}

export interface ParseResult {
  cv: CV
  raw_text: string
  warnings: string[]
  parser: 'heuristic' | 'ai'
  source_format: string
}

export interface RenderResult {
  html: string
  page_count: number | null
}

export interface Finding {
  target_id: string | null
  severity: 'info' | 'warn' | 'error'
  code: string
  message: string
}

export interface Review {
  scores: { star: number; concision: number; impact: number; overall: number }
  summary: string
  findings: Finding[]
}

export interface Edit {
  id: string
  op: 'replace' | 'add_bullet' | 'remove'
  target_id: string
  field: string
  before: string
  after: string
  reason?: string
}

export type ChatAction = 'chat' | 'rewrite' | 'review'

export interface ChatResponse {
  reply: string
  edits: Edit[]
  review: Review | null
  mock: boolean
}

export type ExportFormat = 'pdf' | 'docx' | 'html'

/* ---------- UI-only ---------- */

export type EditStatus = 'pending' | 'accepted' | 'rejected'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  edits?: (Edit & { status: EditStatus })[]
  review?: Review | null
  error?: boolean
  /** True for answers that did not use Gemini (rule-based check). */
  free?: boolean
}

export interface ChatTarget {
  id: string
  label: string
}
