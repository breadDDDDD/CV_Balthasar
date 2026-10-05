import type {
  CV,
  ChatAction,
  ChatResponse,
  ExportFormat,
  Meta,
  ParseResult,
} from './types'
import { exportBasename, renderHtml, withDefaults } from './render'

const BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000').replace(/\/$/, '')

export class ApiError extends Error {
  code: string
  status: number
  constructor(code: string, message: string, status: number) {
    super(message)
    this.code = code
    this.status = status
  }
}

// Every backend call must follow from something the user did (load, upload, edit, export,
// ask Biel). Never poll, keep alive or refetch on a timer or on tab focus: the backend
// scales to zero, and an idle tab, even one left open for months, must not keep it running.
async function request(path: string, init?: RequestInit): Promise<Response> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, init)
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError('offline', `Can't reach the CV service at ${BASE}. Check that it is running.`, 0)
  }
  if (res.ok) return res
  let code = 'internal_error'
  let message = `The CV service returned an error (${res.status}).`
  try {
    const body = await res.json()
    if (body?.error) {
      code = body.error.code ?? code
      message = body.error.message ?? message
    }
  } catch {
    /* non-JSON error body: keep the generic message */
  }
  const wait = Number(res.headers.get('Retry-After'))
  // The service usually says how long to wait itself; only add it when it does not.
  if (res.status === 429 && wait > 0 && !/\bseconds?\b/i.test(message)) message =`${message} Try again in ${Math.ceil(wait)} seconds.`
  throw new ApiError(code, message, res.status)
}

/* ---------- session token for AI calls (contract v1.3) ---------- */

const SESSION_HEADER = 'X-CV-Session'
const REFRESH_MARGIN_MS = 60_000

// Memory only: the token is short-lived and tied to this browser's address.
let session: { token: string; expiresAt: number } | null = null

async function sessionToken(forceNew = false): Promise<string> {
  if (!forceNew && session && session.expiresAt - Date.now() > REFRESH_MARGIN_MS) return session.token
  const body = (await (await request('/api/session')).json()) as { token: string; expires_in: number }
  session = { token: body.token, expiresAt: Date.now() + body.expires_in * 1000 }
  return session.token
}

/** Runs a request that reaches Gemini. A rejected token is replaced and the call retried once. */
async function aiRequest(path: string, init: RequestInit): Promise<Response> {
  const send = async (forceNew: boolean) =>
    request(path, { ...init, headers: { ...init.headers, [SESSION_HEADER]: await sessionToken(forceNew) } })
  try {
    return await send(false)
  } catch (err) {
    if (err instanceof ApiError && err.code === 'invalid_session') return send(true)
    throw err
  }
}

const jsonInit = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  signal,
})

const postJson = (path: string, body: unknown, signal?: AbortSignal) => request(path, jsonInit(body, signal))

export const getMeta = async (): Promise<Meta> => (await request('/api/meta')).json()

export async function parseFile(file: File, ai = false): Promise<ParseResult> {
  const form = new FormData()
  form.append('file', file)
  const send = ai ? aiRequest : request
  return (await send(`/api/parse?ai=${ai}`, { method: 'POST', body: form })).json()
}

export const parseText = async (text: string, ai: boolean): Promise<ParseResult> =>
  (await (ai ? aiRequest : request)('/api/parse/text', jsonInit({ text, ai }))).json()

/** The real PDF page count. The preview itself is drawn in the browser (render.ts). */
export const countPages = async (cv: CV, signal?: AbortSignal): Promise<number | null> =>
  ((await (await postJson('/api/pages', { cv }, signal)).json()) as { page_count: number | null }).page_count

export async function chat(body: {
  cv: CV
  messages: { role: 'user' | 'assistant'; content: string }[]
  target_id?: string | null
  action: ChatAction
}): Promise<ChatResponse> {
  return (await aiRequest('/api/chat', jsonInit(body))).json()
}

export async function exportCv(
  cv: CV,
  format: ExportFormat,
  signal?: AbortSignal,
): Promise<{ blob: Blob; filename: string }> {
  // The HTML export is the preview document itself, so it is made here without a request.
  if (format === 'html') {
    const blob = new Blob([renderHtml(cv)], { type: 'text/html;charset=utf-8' })
    return { blob, filename: `${exportBasename(withDefaults(cv))}.html` }
  }
  const res = await postJson('/api/export', { cv, format }, signal)
  const disposition = res.headers.get('Content-Disposition') ?? ''
  const match = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition)
  const fallback = `CV_${cv.header.name.trim().replace(/\s+/g, '_') || 'export'}.${format}`
  const filename = match ? decodeURIComponent(match[1] ?? match[2]) : fallback
  return { blob: await res.blob(), filename }
}

export function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}
