// Port of backend/app/review.py: the free rule-based check runs in the browser, with no request.
// The fixtures in backend/tests/golden keep it identical to the backend (`npm test`).
import type { CV, Finding, Review } from './types'
import { withDefaults } from './render'

const WEAK_OPENERS = new Set([
  'responsible', 'worked', 'helped', 'assisted', 'participated', 'part', 'learned', 'gained',
  'involved', 'tasked', 'joined', 'duties', 'handled', 'contributed', 'utilized', 'used',
])
const IRREGULAR_VERBS = new Set([
  'led', 'built', 'ran', 'drove', 'won', 'taught', 'wrote', 'grew', 'cut', 'made', 'oversaw',
  'set', 'took', 'brought', 'began', 'held', 'kept', 'met', 'sold', 'spoke', 'rebuilt', 'shipped',
  'spearheaded', 'undertook', 'overcame', 'redid', 'withstood', 'sought', 'thought', 'lent',
])
// Bullets in these sections are descriptions, not achievements.
const DESCRIPTIVE = new Set(['skills', 'languages', 'summary', 'projects', 'publications', 'awards'])

const METRIC = /\d+(?:[.,]\d+)?\s?(?:%|x\b|k\b|m\b|\+)|[$€£¥]|\brp\.?\s?\d|\b(?!(?:19|20)\d{2}\b)\d+\b/i
const PRONOUN = /\b(?:I|my|me|we|our)\b/

const words = (text: string) => text.split(/\s+/).filter(Boolean).length
const firstWord = (text: string) => /^[A-Za-z][A-Za-z'’-]*/.exec(text)?.[0].toLowerCase() ?? ''
const capitalize = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

/** Python's round(): halves go to the even neighbour. */
function round(x: number): number {
  const r = Math.round(x)
  return Math.abs(x % 1) === 0.5 && r % 2 !== 0 ? r - 1 : r
}

export function reviewCv(input: CV): Review {
  const cv = withDefaults(input)
  const findings: Finding[] = []
  let total = 0
  let withAction = 0
  let withMetric = 0
  let tooLong = 0
  const withPeriod: string[] = []
  const withoutPeriod: string[] = []
  const add = (target_id: string | null, severity: Finding['severity'], code: string, message: string) =>
    findings.push({ target_id, severity, code, message })

  if (!cv.header.name.trim()) add('header', 'error', 'no_name', 'The CV has no name.')
  if (!cv.header.contacts.some((c) => c.kind === 'email'))
    add('header', 'warn', 'no_email', 'No email address was found in the contact line.')

  const visible = cv.sections.filter((s) => s.visible)
  if (!visible.some((s) => s.type === 'summary'))
    add(null, 'info', 'no_summary', 'Consider adding a 2-3 line professional summary.')
  if (!visible.some((s) => s.type === 'experience'))
    add(null, 'warn', 'no_experience', 'No work experience section was found.')

  for (const sec of visible) {
    const achievement = !DESCRIPTIVE.has(sec.type)
    if (sec.type === 'summary' && words(sec.text) > 80)
      add(sec.id, 'warn', 'summary_long', 'The summary is over 80 words; aim for 40-60.')
    for (const item of sec.items) {
      if (achievement && item.title && !item.date) add(item.id, 'info', 'no_date', `"${item.title}" has no date.`)
      if (sec.type === 'experience' && !item.bullets.length)
        add(item.id, 'warn', 'no_bullets', `"${item.title}" has no bullet points describing what you achieved.`)
    }
    for (const bullets of [sec.bullets, ...sec.items.map((i) => i.bullets)]) {
      for (const b of bullets) {
        const text = b.text.trim()
        if (!text) continue
        ;(text.endsWith('.') ? withPeriod : withoutPeriod).push(b.id)
        const count = words(text)
        if (count > 32) {
          if (achievement) tooLong += 1
          add(b.id, 'warn', 'too_long', `${count} words. Split it or cut it to under 30.`)
        }
        if (PRONOUN.test(text))
          add(b.id, 'warn', 'first_person', 'Avoid first-person pronouns; start with the action verb.')
        if (!achievement) continue
        total += 1
        const first = firstWord(text)
        if (WEAK_OPENERS.has(first)) {
          add(b.id, 'warn', 'weak_opener', `"${capitalize(first)}" is a weak opener; lead with what you did (Built, Led, Reduced...).`)
        } else if (first.endsWith('ed') || IRREGULAR_VERBS.has(first)) {
          withAction += 1
        } else {
          add(b.id, 'info', 'no_action_verb', 'Start with a past-tense action verb to state the Action clearly.')
        }
        if (METRIC.test(text)) withMetric += 1
        else add(b.id, 'info', 'no_metric', 'No measurable Result. Add a number, percentage, scale or outcome.')
        if (count < 5) add(b.id, 'info', 'too_short', 'Too short to show situation, action and result.')
      }
    }
  }

  if (withPeriod.length && withoutPeriod.length && cv.style.bullet_period === 'keep') {
    const minority = withoutPeriod.length < withPeriod.length ? withoutPeriod : withPeriod
    add(
      null,
      'warn',
      'inconsistent_period',
      `${minority.length} bullet(s) end differently from the rest (trailing period). ` +
        'Set style.bullet_period to "add" or "remove" to make them consistent.',
    )
  }

  const pct = (n: number) => (total ? round((100 * n) / total) : 0)
  const impact = pct(withMetric)
  const star = round((pct(withAction) + impact) / 2)
  const concision = total ? Math.max(0, 100 - round((100 * tooLong) / total)) : 0
  const penalty =
    10 * findings.filter((f) => f.severity === 'error').length +
    3 * findings.filter((f) => f.severity === 'warn' && (f.target_id === null || f.target_id === 'header')).length
  const overall = total ? Math.max(0, round(0.45 * star + 0.25 * concision + 0.3 * impact) - penalty) : 0
  const summary = total
    ? `${withMetric} of ${total} achievement bullets show a measurable result and ${withAction} start with a strong action verb.`
    : 'No achievement bullets were found to review.'
  return { scores: { star, concision, impact, overall }, summary, findings }
}
