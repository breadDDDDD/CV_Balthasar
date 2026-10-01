# CV Editor API contract

Owner: backend agent. The UI reads this file and never edits it; change requests go by message.
Live, always-current schema: `GET /openapi.json` and Swagger UI at `/docs`.

- Dev base URL: `http://localhost:8000`
- CORS: origins from `ALLOWED_ORIGINS` (default `http://localhost:5173`). No cookies, no auth.
- **Stateless**: the server stores nothing. The browser owns the CV JSON and sends the whole
  document with every call. Uploaded files are parsed in memory and dropped.
- All bodies are JSON except the upload (`multipart/form-data`). Nothing streams.

## Errors

Every non-2xx response has this shape:

```json
{ "error": { "code": "unsupported_format", "message": "Human readable text" } }
```

| HTTP | code | when |
|---|---|---|
| 400 | `bad_request` | malformed input |
| 400 | `empty_document` | no text could be extracted (e.g. scanned PDF) |
| 401 | `invalid_session` | AI call without a valid `X-CV-Session` token: fetch a new one and retry once |
| 403 | `forbidden_origin` | request did not come from an allowed browser origin |
| 413 | `file_too_large` | upload over the limit (default 5 MB) |
| 413 | `cv_too_large` | CV JSON text over `MAX_CV_CHARS` |
| 415 | `unsupported_format` | file type not supported |
| 422 | `validation_error` | body does not match the schema |
| 429 | `rate_limited` | a rate limit was hit, on any endpoint (`Retry-After` header set) |
| 422 | `ai_blocked` | Gemini's safety filter declined the request |
| 502 | `ai_error` | Gemini failed, returned unusable output, or a re-parse was discarded by a guardrail |
| 503 | `ai_unavailable` | no `GEMINI_API_KEY` configured |
| 503 | `pdf_unavailable` | PDF engine missing (only on a dev machine without WeasyPrint libs) |
| 500 | `internal_error` | anything else |

## Access control (v1.3)

- **Origin.** Every `/api/*` call except `/api/health` must come from an origin listed in
  `ALLOWED_ORIGINS`. The browser sends `Origin` by itself on cross-origin calls; the UI has nothing
  to add. Anything else gets `403 forbidden_origin`.
- **Session token for AI.** Calls that reach Gemini (`POST /api/chat`, and `/api/parse` or
  `/api/parse/text` with `ai=true`) need the header `X-CV-Session: <token>`, also in mock mode.
  Get the token from `GET /api/session` → `{ "token": "...", "expires_in": 600 }`. It lasts
  `expires_in` seconds and is tied to the caller's IP address. Recommended client logic: fetch
  lazily before the first AI call, cache it in memory, refresh when it is within 60 s of expiry,
  and on `401 invalid_session` fetch a new token and retry the call once.
- **Rate limits** per IP address: 90 calls/minute over all endpoints, 12 uploads/minute on
  `/api/parse`, 8 AI calls/minute and 40 AI calls/day (plus a per-instance daily AI cap). On
  `429` wait `Retry-After` seconds; do not auto-retry in a loop. Debounced render calls (one per
  ~400 ms at most while typing) fit inside the limit.

## CV document

```jsonc
{
  "version": 1,
  "header": {
    "name": "Jane Doe",
    "headline": "",                       // optional line under the name
    "contacts": [                         // rendered on one line, joined with " | "
      { "id": "ctc_ab12", "kind": "email", "text": "jane@x.com", "url": "mailto:jane@x.com" }
    ]
  },
  "sections": [                           // array order = display order
    {
      "id": "sec_ab12",
      "type": "experience",               // semantic hint only, see list below
      "title": "Experiences",
      "title_url": null,                  // optional link shown beside the title
      "show_title": true,                 // false = render content without a heading (e.g. summary)
      "visible": true,                    // false = kept in JSON, skipped in render and export
      "text": "",                         // paragraph; "\n" = line break
      "bullets": [ { "id": "blt_1", "text": "..." } ],   // bullets directly under the section
      "items": [                          // array order = display order
        {
          "id": "itm_ab12",
          "title": "PT. Example",         // bold, left
          "subtitle": "AI Engineer",      // line under the title
          "date": "April 2026 - Now",     // right-aligned on the title line, regular weight
          "location": "",                 // right-aligned on the subtitle line
          "lines":   [ { "id": "blt_2", "text": "GPA : 3.51/4" } ],  // plain lines, no glyph
          "bullets": [ { "id": "blt_3", "text": "Built ..." } ]
        }
      ]
    }
  ],
  "style": {
    "page_size": "A4",                    // "A4" | "Letter"
    "margin_mm": 12.7,                    // 5..30, same on all four sides
    "font": "arial",                      // "arial" | "calibri" | "times" | "cambria"
    "font_size_pt": 10,                   // 7..13 body size; headings scale from it
    "line_height": 1.3,                   // 1.0..2.0
    "accent_color": "#111111",            // name, section titles and rules
    "heading_style": "rule",              // "rule" | "plain"
    "name_align": "left",                 // "left" | "center"
    "text_align": "left",                 // "left" | "justify" (body text and bullets)
    "bullet_period": "keep"               // "keep" | "add" | "remove"
  }
}
```

Rules:

- `type`: `summary | experience | education | projects | skills | certifications | organizations |
  volunteer | awards | languages | publications | custom`. Every section has the same fields and
  every non-empty field is rendered (`text`, then `bullets`, then `items`), whatever the type.
- `contact.kind`: `phone | email | location | linkedin | github | website | other`.
- **Ids**: strings, unique in the document, returned by parse and echoed back unchanged. When the
  UI adds a section/item/bullet it may make its own id (any unique string) or omit `id` and the
  server generates one. `"header"` is a reserved target id for AI edits.
- Unknown fields are ignored (not rejected). Missing fields get the defaults above.
- Text is plain text. No markdown, no HTML; the server escapes everything.

### Bullets and the trailing dot

- Bullet `text` never contains a glyph. The server draws the glyph (real list markup in HTML/PDF,
  a real Word list in DOCX) with a hanging indent, so wrapped lines align.
- **On parse** the server strips glyphs (`• ● ○ ▪ - * ·` etc.), joins wrapped lines back into one
  bullet, collapses whitespace and fixes stray punctuation (`"text ."` → `"text."`, `".."` → `"."`).
  It does not add or remove a final period.
- **On render/export** `style.bullet_period` is applied to every bullet in `bullets` (not `lines`):
  `keep` leaves text as typed, `add` ensures one final `.`, `remove` strips it. The same code runs
  for preview, PDF, DOCX and HTML, so they always agree. The UI should not post-process bullet text.

## Endpoints

### `GET /api/health`
`{ "status": "ok" }`

### `GET /api/meta`
```jsonc
{
  "import_formats": ["pdf", "docx", "txt", "md", "rtf", "odt"],
  "export_formats": ["pdf", "docx", "html"],
  "max_upload_bytes": 5242880,
  "ai_enabled": true,          // false = hide/disable the chat and AI re-parse
  "ai_mock": false,            // true = AI answers are canned (dev mode, no Gemini calls)
  "ai_model": "gemini-3-flash-preview",
  "pdf_available": true,       // false = PDF export and page_count unavailable on this machine
  "section_types": ["summary", "..."],
  "fonts": ["arial", "calibri", "times", "cambria"],
  "blank_cv": { /* an empty CV with default style, use for "start from scratch" */ }
}
```

### `POST /api/parse?ai=false`  (multipart, field name `file`)
Parses an upload into a CV. `ai=true` sends the extracted text to Gemini instead of the
heuristic parser. It costs one Gemini call, so only use it on an explicit user action.

```jsonc
{
  "cv": { /* CV */ },
  "raw_text": "plain text extracted from the file",
  "warnings": ["Could not find a name; the first line was used."],
  "parser": "heuristic",       // or "ai"
  "source_format": "pdf"
}
```
For PDFs and DOCX the page size, margin and body font size are detected and put in `cv.style`.

### `POST /api/parse/text`
Body `{ "text": "...", "ai": false }` → same response as `/api/parse`. Use this for the
"AI re-parse" button: send back `raw_text` with `ai: true` instead of re-uploading the file.

### `POST /api/render`
Body `{ "cv": CV, "page_count": true }` → `{ "html": "<!doctype html>...", "page_count": 2 }`

- `html` is one self-contained document (CSS inlined, no external requests, no scripts): put it
  in `<iframe srcdoc>`. It is the exact markup WeasyPrint turns into the PDF.
- On screen it draws a sheet of paper of the real page width with the margins as padding, on a
  transparent background. The sheet is `style.page_size` wide (A4 = 210mm, Letter = 8.5in); scale
  the iframe with CSS `transform` to fit your pane. The screen view is one continuous sheet; page
  breaks are only exact in the PDF.
- `page_count` is the real PDF page count, or `null` when `page_count: false` was sent or the PDF
  engine is unavailable. Computing it lays out the PDF (~100-300 ms); debounce ~400 ms is fine.
- Every rendered element carries `data-id="<section/item/bullet id>"` so the preview can
  highlight or scroll to what is being edited.

### `POST /api/export`
Body `{ "cv": CV, "format": "pdf" | "docx" | "html", "filename": "optional-base-name" }` →
the file, with `Content-Disposition: attachment; filename="..."` (exposed via CORS) and the right
`Content-Type`. Default filename is `CV_<name>.<ext>`.

### `POST /api/review`  (free, no AI)
Body `{ "cv": CV }` → `Review`. Rule-based lint: action verbs, measurable results, bullet length,
weak openers, tense and trailing-period consistency. Safe to call often.

```jsonc
{
  "scores": { "star": 62, "concision": 80, "impact": 45, "overall": 64 },   // 0..100
  "summary": "12 of 30 bullets show a measurable result.",
  "findings": [
    { "target_id": "blt_3", "severity": "warn", "code": "no_metric", "message": "..." }
  ]
}
```
`severity`: `info | warn | error`. `target_id` may be `null` for document-level findings.

### `POST /api/chat`  (Gemini, rate limited)
One JSON response, no streaming.

```jsonc
// request
{
  "cv": { /* CV */ },
  "messages": [ { "role": "user", "content": "Make my experience bullets stronger" } ],
  "target_id": "sec_ab12",     // optional: section, item or bullet the user is focused on
  "action": "chat"             // "chat" | "rewrite" | "review"
}
```
- `chat`: free conversation; the last message must be from the user.
- `rewrite`: rewrite `target_id` (or the whole CV if null) in STAR style; `messages` may be empty.
- `review`: full AI review with scores; `messages` may be empty.
- Only the last 12 messages are used; each is capped at 4000 characters.

```jsonc
// response
{
  "reply": "I tightened three bullets ...",
  "edits": [
    {
      "id": "edt_1",
      "op": "replace",          // "replace" | "add_bullet" | "remove"
      "target_id": "blt_3",
      "field": "text",
      "before": "Worked on models",
      "after": "Deployed 4 models ...",
      "reason": "Leads with the action and adds the result."
    }
  ],
  "review": null,               // a Review object when action = "review"
  "mock": false
}
```

Edits are **proposals**: the server never changes the CV, the UI shows accept/reject and applies
them. The server validates every edit against the CV you sent and drops invalid ones.

| op | target_id | field | meaning |
|---|---|---|---|
| `replace` | bullet or line id | `text` | set that bullet's text |
| `replace` | item id | `title` `subtitle` `date` `location` | set that field |
| `replace` | section id | `title` `text` | set that field |
| `replace` | `"header"` | `name` `headline` | set that field |
| `add_bullet` | item id or section id | `bullets` | append a bullet with text `after` (`before` is `""`) |
| `remove` | bullet or line id | `text` | delete that bullet (`after` is `""`) |

`before` is always the current value taken from the CV you sent, so you can detect a stale edit
(the user changed the field since) by comparing it with your state before applying.

### AI guardrails (server side, nothing for the UI to do)

- Only CV and job-application questions are answered. Off-topic or prompt-injection messages get a normal 200 with a fixed refusal in `reply` and
  `edits: []`. No Gemini call is made. Show it like any other reply.
- `reply` is plain text, at most 1500 characters, and may contain `\n` line breaks.
- At most 12 edits per response. Edit text is plain text (markup, markdown and bullet glyphs are
  stripped) and capped per field (bullet 600, title/subtitle/headline 160, section text 1500).
- An edit that introduces a number that is not in the CV or in the user's messages is withheld;
  `reply` then ends with a sentence saying how many were withheld.
- With `action: "rewrite"` and a `target_id`, edits are limited to that element and its children.
- An unknown `target_id` is treated as null.
- An AI re-parse that rewrites the wording instead of copying it is discarded (`ai_error`).

## Stability guarantees the UI depends on

These will not change without a message to the UI agent first:

- `data-id` attributes on every rendered section, item, bullet, line and contact, and `data-id="header"`.
- The sheet (`<main class="page">`) is the only content of `<body>` in the render HTML.
- `before` on every edit holds the value from the CV that was sent.
- `ai_enabled`, `ai_mock` and `pdf_available` in `/api/meta`.

## Changelog
- v1.3: access control: origin check on all endpoints, `GET /api/session` + `X-CV-Session` header for AI calls, rate limits on every endpoint; new error codes `invalid_session` (401) and `forbidden_origin` (403).
- v1.2: AI guardrails; `ai_model` in `/api/meta`; new error code `ai_blocked` (422).
- v1.1: added `style.text_align`; item dates render in regular weight; stability guarantees listed.
- v1: initial contract.
