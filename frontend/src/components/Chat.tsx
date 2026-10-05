import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Check, SendHorizontal, X } from 'lucide-react'
import type { CV, ChatAction, ChatMessage, ChatTarget, Edit, EditStatus, Meta, Review } from '../types'
import { applyEdit, currentValue, uid, type Update } from '../store'
import { ApiError, chat } from '../api'
import { reviewCv } from '../review'
import { Mascot, type MascotMood } from './Mascot'

const GREETING: ChatMessage = {
  id: 'greeting',
  role: 'assistant',
  text: "I'm Biel. I check your CV for STAR structure, wordiness and impact, and I can rewrite a bullet, an entry or a whole section. Every change is a suggestion you accept or reject.",
}

const SCORE_LABELS: [keyof Review['scores'], string][] = [
  ['overall', 'Overall'],
  ['star', 'STAR structure'],
  ['concision', 'Concision'],
  ['impact', 'Impact'],
]

function ReviewCard({ review, onFocus }: { review: Review; onFocus: (id: string) => void }) {
  const [all, setAll] = useState(false)
  const findings = all ? review.findings : review.findings.slice(0, 6)
  return (
    <div className="review">
      <dl className="scores">
        {SCORE_LABELS.map(([key, label]) => (
          <div className="score" key={key}>
            <dt>{label}</dt>
            <dd>
              <span className={`score__bar ${review.scores[key] < 40 ? 'score__bar--low' : ''}`}>
                <span style={{ width: `${Math.max(0, Math.min(100, review.scores[key]))}%` }} />
              </span>
              <span className="score__value">{Math.round(review.scores[key])}</span>
            </dd>
          </div>
        ))}
      </dl>
      {review.summary && <p className="review__summary">{review.summary}</p>}
      {findings.length > 0 && (
        <ul className="findings">
          {findings.map((f, i) => (
            <li key={i} className={`finding finding--${f.severity}`}>
              {f.target_id ? (
                <button type="button" onClick={() => onFocus(f.target_id!)} title="Show this in the editor">
                  {f.message}
                </button>
              ) : (
                <span>{f.message}</span>
              )}
            </li>
          ))}
        </ul>
      )}
      {review.findings.length > 6 && (
        <button type="button" className="link-btn" onClick={() => setAll((a) => !a)}>
          {all ? 'Show fewer' : `Show all ${review.findings.length} notes`}
        </button>
      )}
    </div>
  )
}

function EditCard({
  edit,
  cv,
  onDecide,
  onFocus,
}: {
  edit: Edit & { status: EditStatus }
  cv: CV
  onDecide: (status: EditStatus) => void
  onFocus: (id: string) => void
}) {
  const now = currentValue(cv, edit)
  const pending = edit.status === 'pending'
  const stale = pending && (now === null || (edit.op !== 'add_bullet' && now !== edit.before))
  const heading = edit.op === 'add_bullet' ? 'Add a bullet' : edit.op === 'remove' ? 'Remove this bullet' : 'Rewrite'
  return (
    <div className={`edit edit--${edit.status}`}>
      <button type="button" className="edit__where" onClick={() => onFocus(edit.target_id)} title="Show this in the editor">
        {heading}
      </button>
      {edit.before && <p className="edit__before">{edit.before}</p>}
      {edit.after && <p className="edit__after">{edit.after}</p>}
      {edit.reason && <p className="edit__reason">{edit.reason}</p>}
      {pending && stale && (
        <p className="edit__stale">
          {now === null ? 'That part of the CV no longer exists.' : 'You changed this text after the suggestion was made.'}
        </p>
      )}
      {pending ? (
        <div className="edit__actions">
          <button type="button" className="btn btn--primary btn--small" disabled={stale} onClick={() => onDecide('accepted')}>
            <Check size={14} /> Accept
          </button>
          <button type="button" className="btn btn--quiet btn--small" onClick={() => onDecide('rejected')}>
            Reject
          </button>
        </div>
      ) : (
        <p className="edit__done">{edit.status === 'accepted' ? 'Accepted' : 'Rejected'}</p>
      )}
    </div>
  )
}

interface Props {
  cv: CV
  update: Update
  meta: Meta | null
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ChatTarget | null
  onClearTarget: () => void
  onFocus: (id: string) => void
}

export function Chat({ cv, update, meta, open, onOpenChange, target, onClearTarget, onFocus }: Props) {
  const [messages, setMessages] = useState<ChatMessage[]>([GREETING])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [talking, setTalking] = useState(false)
  const listRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const aiOff = meta !== null && !meta.ai_enabled
  const mood: MascotMood = loading ? 'thinking' : talking ? 'talking' : 'idle'

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (!open) return
    inputRef.current?.focus()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onOpenChange(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  useEffect(() => {
    if (!talking) return
    const t = setTimeout(() => setTalking(false), 1800)
    return () => clearTimeout(t)
  }, [talking])

  const push = (m: Omit<ChatMessage, 'id'>) => setMessages((list) => [...list, { ...m, id: uid('msg') }])

  const fail = (err: unknown) =>
    push({
      role: 'assistant',
      error: true,
      text: err instanceof ApiError ? err.message : 'Something went wrong. Try again.',
    })

  // One Gemini call per press. Nothing here runs on its own.
  async function ask(text: string, action: ChatAction) {
    if (loading || aiOff) return
    const history = [...messages.filter((m) => !m.error && m.id !== 'greeting'), { role: 'user' as const, text }]
    push({ role: 'user', text })
    setInput('')
    setLoading(true)
    try {
      const res = await chat({
        cv,
        action,
        target_id: target?.id ?? null,
        messages: history.map((m) => ({ role: m.role, content: m.text })),
      })
      push({
        role: 'assistant',
        text: res.reply,
        review: res.review,
        edits: res.edits.map((e) => ({ ...e, status: 'pending' as const })),
      })
      setTalking(true)
    } catch (err) {
      fail(err)
    } finally {
      setLoading(false)
    }
  }

  // Runs in the browser (review.ts): no request, so it works even while the backend is asleep.
  function freeCheck() {
    if (loading) return
    push({ role: 'user', text: 'Run the quick check' })
    push({ role: 'assistant', text: 'Here is the rule-based check. It does not use AI.', review: reviewCv(cv), free: true })
    setTalking(true)
  }

  const setStatus = (messageId: string, editIds: string[], status: EditStatus) =>
    setMessages((list) =>
      list.map((m) =>
        m.id === messageId
          ? { ...m, edits: m.edits?.map((e) => (editIds.includes(e.id) ? { ...e, status } : e)) }
          : m,
      ),
    )

  const decide = (message: ChatMessage, edit: Edit, status: EditStatus) => {
    if (status === 'accepted') {
      update((c) => applyEdit(c, edit))
      onFocus(edit.target_id)
    }
    setStatus(message.id, [edit.id], status)
  }

  const acceptAll = (message: ChatMessage) => {
    const usable = (message.edits ?? []).filter((e) => {
      if (e.status !== 'pending') return false
      const now = currentValue(cv, e)
      return now !== null && (e.op === 'add_bullet' || now === e.before)
    })
    if (usable.length === 0) return
    update((c) => usable.reduce(applyEdit, c))
    setStatus(message.id, usable.map((e) => e.id), 'accepted')
  }

  const where = target ? `"${target.label}"` : 'my whole CV'

  return (
    <>
      <AnimatePresence>
        {!open && (
          <motion.button
            type="button"
            className="chat-tab"
            aria-label="Open Biel, the CV assistant"
            onClick={() => onOpenChange(true)}
            initial={{ x: -70 }}
            animate={{ x: 0 }}
            exit={{ x: -70 }}
            whileHover={{ x: 10 }}
            whileTap={{ scale: 0.96 }}
            transition={{ type: 'spring', bounce: 0.2, duration: 0.45 }}
          >
            <Mascot size={54} />
            <span>Ask Biel</span>
          </motion.button>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.aside
            className="chat"
            aria-label="CV assistant"
            initial={{ x: -420 }}
            animate={{ x: 0 }}
            exit={{ x: -420 }}
            transition={{ type: 'spring', bounce: 0.14, duration: 0.5 }}
          >
            <header className="chat__head">
              <Mascot size={52} mood={mood} />
              <div>
                <h2>Biel</h2>
                <p>{loading ? 'Reading your CV' : meta?.ai_mock ? 'Practice mode, no AI calls' : 'CV reviewer'}</p>
              </div>
              <button type="button" className="icon-btn" aria-label="Close assistant" onClick={() => onOpenChange(false)}>
                <X size={18} />
              </button>
            </header>

            <div className="chat__list" ref={listRef}>
              {messages.map((m) => (
                <div key={m.id} className={`msg msg--${m.role} ${m.error ? 'msg--error' : ''}`}>
                  {m.text && <p className="msg__text">{m.text}</p>}
                  {m.review && <ReviewCard review={m.review} onFocus={onFocus} />}
                  {m.edits && m.edits.length > 0 && (
                    <div className="edits">
                      {m.edits.filter((e) => e.status === 'pending').length > 1 && (
                        <button type="button" className="link-btn" onClick={() => acceptAll(m)}>
                          Accept all {m.edits.filter((e) => e.status === 'pending').length} suggestions
                        </button>
                      )}
                      {m.edits.map((e) => (
                        <EditCard key={e.id} edit={e} cv={cv} onFocus={onFocus} onDecide={(s) => decide(m, e, s)} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="msg msg--assistant msg--typing" aria-label="Biel is working">
                  <span />
                  <span />
                  <span />
                </div>
              )}
            </div>

            <footer className="chat__foot">
              {target && (
                <div className="target">
                  <span>About: {target.label}</span>
                  <button type="button" aria-label="Ask about the whole CV instead" onClick={onClearTarget}>
                    <X size={13} />
                  </button>
                </div>
              )}
              <div className="quick">
                <button type="button" onClick={freeCheck} disabled={loading} title="Rule-based, does not use AI">
                  Quick check (free)
                </button>
                <button type="button" disabled={loading || aiOff} onClick={() => ask(`Rewrite ${where} using the STAR method`, 'rewrite')}>
                  Rewrite with STAR
                </button>
                <button type="button" disabled={loading || aiOff} onClick={() => ask(`Review ${where}`, 'review')}>
                  AI review
                </button>
              </div>
              {aiOff && (
                <p className="chat__note">
                  The assistant needs a Gemini key on the CV service. The quick check works without one.
                </p>
              )}
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault()
                  if (input.trim()) ask(input.trim(), 'chat')
                }}
              >
                <textarea
                  ref={inputRef}
                  rows={2}
                  value={input}
                  disabled={aiOff}
                  placeholder="Ask about your CV"
                  aria-label="Message to Biel"
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      if (input.trim()) ask(input.trim(), 'chat')
                    }
                  }}
                />
                <button type="submit" className="btn btn--primary" disabled={loading || aiOff || !input.trim()} aria-label="Send">
                  <SendHorizontal size={17} />
                </button>
              </form>
            </footer>
          </motion.aside>
        )}
      </AnimatePresence>
    </>
  )
}
