# Balthasar CV editor: UI

The web UI for the CV editor. Editor on the left, live page preview on the right, and Biel
(the assistant) in a drawer that slides out from the left edge.

It is a static site (Vite + React + TypeScript). It holds the CV in the browser tab and talks
to the backend in `../backend` over the contract in `../backend/API.md`. It stores nothing on
a server, and it only calls Gemini when you press an AI button.

## Run it locally

Needs Node 20 or newer, and the backend running on `http://localhost:8000`
(see `../backend` for how to start it).

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173
```

The backend allows `http://localhost:5173` by default, so keep that port.

## Settings

One setting, read at build time:

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_BASE_URL` | `http://localhost:8000` | Address of the backend, no trailing slash |

Copy `.env.example` to `.env.local` to change it for local work.

## Deploy

1. Deploy the backend first and note its URL, for example `https://cv-backend-xxxx.run.app`.
2. Build the UI with that URL:

   ```bash
   VITE_API_BASE_URL=https://cv-backend-xxxx.run.app npm run build
   ```

   PowerShell: `$env:VITE_API_BASE_URL = 'https://cv-backend-xxxx.run.app'; npm run build`

3. Upload the `dist/` folder to any static host.
4. On the backend, add the UI's address to `ALLOWED_ORIGINS`
   (for example `https://my-cv.vercel.app`). Without this the browser blocks every request.

Host-specific settings, all with root directory `frontend`:

| Host | Build command | Output folder | Where to put `VITE_API_BASE_URL` |
|---|---|---|---|
| Vercel | `npm run build` | `dist` | Project Settings, Environment Variables |
| Netlify | `npm run build` | `dist` | Site configuration, Environment variables |
| Cloudflare Pages | `npm run build` | `dist` | Settings, Variables and Secrets |
| Firebase Hosting | run `npm run build` yourself | `dist` (set as `public`) | your shell, before building |

Changing `VITE_API_BASE_URL` needs a rebuild; it is baked into the JavaScript.

## What is where

```
src/
  api.ts               every backend call, one error type
  types.ts             the CV shape, mirrors backend/API.md
  store.ts             CV state, undo/redo, applying assistant suggestions
  App.tsx              top bar, import, download, layout of the two panes
  styles.css           all styling; palette tokens at the top
  components/
    Landing.tsx        first screen: open a file or start blank
    Editor.tsx         sections, entries, bullets, drag and keyboard reordering
    Preview.tsx        the page (backend HTML in an iframe), exact PDF view, page layout panel
    Chat.tsx           Biel: quick check (free), STAR rewrite, AI review, accept/reject
    Mascot.tsx         Biel, drawn in SVG
```

## Notes

- The CV is kept in `sessionStorage`: it survives a refresh and is gone when the tab closes.
- "Quick check (free)" uses the backend's rule-based review. "Rewrite with STAR", "AI review",
  typed chat messages and "Re-read the file with AI" each make one Gemini call.
- "Live" preview is one continuous sheet. "Exact PDF" shows the real export, so page breaks
  there are the real ones. The page count in the corner is always the real PDF count.
- Reorder with the grip handle, or focus a handle and press the up and down arrow keys.
