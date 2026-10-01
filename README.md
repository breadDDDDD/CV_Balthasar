<div align="center">

<img src="docs/biel-reading.gif" alt="Biel reading through your CV" width="460" />

# Balthasar

**Change one line of your CV. The rest of the page keeps up.**

*Biel, reading through your CV before a recruiter does.*

### [Try it live → cv-balthasar.vercel.app](https://cv-balthasar.vercel.app/)

</div>

Balthasar is a CV editor. Open the CV you already have (PDF, DOCX, TXT, MD, RTF or ODT) and it is
split into sections, entries and bullets you can edit, reorder and hide, with the printed page
beside you the whole time. Biel, the built-in assistant, reviews your bullets and proposes
rewrites that you accept or reject one by one.

## Why it is worth a look

- **Bring your own CV.** No template to retype into. A rule-based parser reads the file,
  detects page size, margins and font size, and rebuilds the structure. One click re-reads it
  with AI if the layout was unusual.
- **The preview is the PDF.** The HTML you see in the preview is the exact markup that becomes
  the PDF, and the page counter in the corner is the real PDF page count. No surprise second page
  after export.
- **Export to PDF, DOCX and HTML** from the same document, with real list markup and matching
  line breaks in each format.
- **A free review that costs nothing to run.** "Quick check" scores every bullet for action
  verbs, measurable results, length, tense and consistency. No AI call involved.
- **An assistant that cannot invent your achievements.** Biel rewrites bullets in STAR style,
  but any edit containing a number that is not already in your CV or your own messages is
  withheld. Every edit is a proposal with a before/after and a reason; nothing changes until you
  accept it.
- **Nothing is stored.** The server has no database, no disk writes and no body logging. Your CV
  lives in the browser tab and is gone when you close it.

## How it works

```
  Browser (React)                              Backend (FastAPI, stateless)
 ┌────────────────────────┐   upload file     ┌──────────────────────────────┐
 │ Editor   Preview  Biel │ ────────────────▶ │ parse    file → CV JSON      │
 │                        │ ◀──────────────── │                              │
 │  CV JSON lives here    │   whole CV JSON   │ render   CV → HTML + pages   │
 │  (sessionStorage,      │ ────────────────▶ │ export   CV → PDF/DOCX/HTML  │
 │   undo/redo)           │ ◀──────────────── │ review   rule-based lint     │
 │                        │                   │ chat     guardrails → Gemini │
 └────────────────────────┘                   └──────────────────────────────┘
```

1. **Parse.** The upload is read in memory into lines with layout hints (bold, size, position),
   then grouped into header, sections, items and bullets. The file is dropped when the request
   ends.
2. **Edit.** The browser owns the CV as one JSON document and sends the whole thing with every
   call. The server keeps no session and no copy.
3. **Render.** `POST /api/render` returns one self-contained HTML page shown in an iframe. It is
   the same markup WeasyPrint turns into the PDF, so preview and export always agree. Every
   element carries a `data-id`, so the preview highlights what you are editing.
4. **Review.** The rule-based check returns scores (STAR, concision, impact) and findings pinned
   to individual bullets.
5. **Ask Biel.** Chat, STAR rewrite and AI review each make one Gemini call. The server validates
   every proposed edit against the CV you sent and drops the invalid ones; the UI shows the rest
   as accept/reject cards and detects edits that went stale while you were typing.

### Guardrails around the AI

- Only CV and job-application questions are answered. Off-topic and prompt-injection messages
  get a fixed refusal before Gemini is ever called, so they cost nothing.
- No invented metrics, plain-text output only, at most 12 edits per reply, and a rewrite stays
  inside the element you pointed at.
- An AI re-parse must reuse the document's own words or it is discarded.
- Origin check, short-lived IP-bound session tokens for AI calls, and per-IP and per-instance
  rate limits keep the Gemini bill bounded.

Details: [backend/README.md](backend/README.md#ai-guardrails).

## Quick start

The app is live at **https://cv-balthasar.vercel.app/**, so you only need the steps below to run
it yourself.

You need Docker (or [uv](https://docs.astral.sh/uv/)) for the backend and Node 20+ for the UI.

```bash
# 1. backend on http://localhost:8000, with canned AI answers (no key, no spend)
cd backend
docker build -t cv-backend .
docker run --rm -p 8000:8080 -e AI_MOCK=1 cv-backend

# 2. UI on http://localhost:5173
cd frontend
npm install
npm run dev
```

Open http://localhost:5173 and drop a CV on the page.

To use the real assistant, put `GEMINI_API_KEY=...` in a `.env` file at the repo root and start
the backend with `--env-file ../.env` instead of `-e AI_MOCK=1`.

Without Docker: `cd backend && uv sync && uv run uvicorn app.main:app --reload --port 8000`.
On Windows this runs everything except PDF export, which needs the WeasyPrint native libraries
that the Docker image ships with.

## Project layout

| Path | What it is |
|---|---|
| [`backend/`](backend/README.md) | FastAPI service: parsing, rendering, export, review, Gemini proxy. Configuration, tests and Cloud Run deployment are documented there. |
| [`backend/API.md`](backend/API.md) | The contract between UI and backend: CV schema, endpoints, error codes. |
| [`frontend/`](frontend/README.md) | Vite + React + TypeScript UI: editor, live preview, Biel's chat drawer. Static-host deployment is documented there. |

## Tech

**Backend:** Python, FastAPI, WeasyPrint (PDF), python-docx, Jinja2, Gemini.
**Frontend:** React 19, TypeScript, Vite, Motion.
**Hosting:** Cloud Run scaled to zero for the backend, any static host for the UI.

## Limits

- Parsing works best on single-column CVs. Multi-column PDFs produce a warning.
- Scanned (image-only) PDFs are rejected; there is no OCR. Legacy `.doc` is not supported.

## Credits

Biel is drawn after Yuki Osanai from *Shoshimin: How to Become Ordinary*. The GIF above is a clip
from the anime and belongs to its rights holders; it is used here as a fan reference only.
