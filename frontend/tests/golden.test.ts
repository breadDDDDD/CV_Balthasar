// The browser ports of the renderer and the quick check against the backend's own output.
// Fixtures live in backend/tests/golden; see the note in backend/API.md before editing.
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, test } from 'vitest'
import { exportBasename, renderHtml, withDefaults } from '../src/render'
import { reviewCv } from '../src/review'
import type { CV } from '../src/types'

const GOLDEN = join(import.meta.dirname, '../../backend/tests/golden')
const cases = readdirSync(GOLDEN)
  .filter((f) => f.endsWith('.cv.json'))
  .map((f) => f.slice(0, -'.cv.json'.length))
const read = (name: string) => JSON.parse(readFileSync(join(GOLDEN, name), 'utf-8'))

// Jinja leaves irregular whitespace between tags and Python writes 10.0 where JS writes 10.
// Neither changes how the page is drawn; text, attributes and CSS values must still match.
const normalize = (html: string) =>
  html
    .replace(/<style>([\s\S]*?)<\/style>/, (_, css: string) =>
      `<style>${css.replace(/(\d+)\.0(?!\d)/g, '$1').replace(/\s+/g, ' ').replace(/\s*([{};])\s*/g, '$1').trim()}</style>`)
    .replace(/>\s+</g, '><')
    .trim()

test('fixtures are present', () => {
  expect(cases.length).toBeGreaterThan(0)
})

describe.each(cases)('%s', (name) => {
  const input = read(`${name}.cv.json`) as CV
  const expected = read(`${name}.expected.json`)

  test('html matches the backend', () => {
    expect(normalize(renderHtml(input))).toBe(normalize(expected.html))
  })
  test('quick check matches the backend', () => {
    expect(reviewCv(input)).toEqual(expected.review)
  })
  test('export filename matches the backend', () => {
    expect(exportBasename(withDefaults(input))).toBe(expected.filename)
  })
})
