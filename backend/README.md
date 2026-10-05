# CV Editor backend

FastAPI service that parses CVs (PDF, DOCX, TXT, MD, RTF, ODT), renders the preview HTML, exports
PDF / DOCX / HTML, and proxies the Gemini assistant. The API contract for the UI is in
[API.md](API.md).

**Stateless by design.** The browser holds the CV. Uploads are parsed in memory and dropped when
the request ends; nothing is written to disk, a database or a bucket, and request bodies are never
logged. There is therefore nothing to expire or clean up, and nothing that can be billed for
storage. With Cloud Run min-instances 0 you pay only while a request is being handled.

## Layout

```
app/
  main.py            routes, CORS, error shape
  models.py          CV schema and request/response bodies
  config.py          environment variables
  parsing/extract.py file bytes -> text lines with layout hints
  parsing/structure.py  lines -> header / sections / items / bullets (rule based)
  render/html.py     CV -> self-contained HTML (templates/cv.html.j2)
  render/pdf.py      HTML -> PDF (WeasyPrint)
  render/docx.py     CV -> DOCX
  review.py          free rule-based review (STAR, concision, impact)
  ai.py              Gemini chat / rewrite / review / re-parse, rate limiter, mock mode
  usage.py           token / cost metadata line per Gemini call (see "AI usage tracking")
tests/               pytest suite; Gemini is stubbed, it can never be called
```

## Run locally

### Docker (recommended, required for PDF on Windows)

```bash
cd backend
docker build -t cv-backend .

# without AI spend: canned AI answers
docker run --rm -p 8000:8080 -e AI_MOCK=1 cv-backend

# with the real assistant, reading GEMINI_API_KEY from the repo-root .env
docker run --rm -p 8000:8080 --env-file ../.env cv-backend
```

Open http://localhost:8000/docs.

### uv (no Docker)

```bash
cd backend
uv sync
uv run uvicorn app.main:app --reload --port 8000
```

`GEMINI_API_KEY` is picked up from `backend/.env` or the repo-root `.env`. On Windows the native
libraries WeasyPrint needs are usually missing: everything works except PDF export and
`page_count` (`/api/meta` reports `pdf_available: false`). Use Docker for PDF.

### Tests

```bash
uv run pytest                 # PDF test is skipped where WeasyPrint is unavailable
```

Full suite including PDF, inside the image:

```bash
docker run --rm -u root -v "$PWD/..:/src:ro" -w /src/backend \
  -e UV_PROJECT_ENVIRONMENT=/tmp/venv cv-backend \
  sh -c "uv sync --frozen -q && uv run --frozen pytest -q -p no:cacheprovider"
```

The tests blank `GEMINI_API_KEY` before the app loads and replace the Gemini call with a function
that fails the test, so running them costs nothing.

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `GEMINI_API_KEY` | (none) | Enables chat / rewrite / AI review / AI re-parse. Without it those return `ai_unavailable`. |
| `GEMINI_MODEL` | `gemini-3-flash-preview` | Model id. Must be in the allow-list in `app/guardrails.py`; any other value is ignored and the default is used. |
| `AI_MOCK` | `0` | `1` = canned AI answers, never calls Gemini. Use for UI development. |
| `ALLOWED_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Comma-separated CORS origins. Set to the deployed UI origin. |
| `AI_RATE_PER_MINUTE` | `8` | Gemini calls per client IP per minute. |
| `AI_RATE_PER_IP_DAY` | `40` | Gemini calls per client IP per day. |
| `RATE_PER_MINUTE` | `90` | Calls to any endpoint per client IP per minute. |
| `PARSE_RATE_PER_MINUTE` | `12` | Uploads per client IP per minute. |
| `ENFORCE_ORIGIN` | `1` | Reject calls whose `Origin` is not in `ALLOWED_ORIGINS`. Leave on. |
| `SESSION_SECRET` | random per instance | Key that signs AI session tokens. Optional; without it tokens simply stop working when the instance restarts and the UI fetches a new one. |
| `USAGE_HASH_SALT` | random per instance | Salt for the visitor hash in usage records. Set it (any long random string, e.g. as a secret) so the same visitor gets the same hash across instances and restarts. |
| `SESSION_TTL_SECONDS` | `600` | Lifetime of an AI session token. |
| `TRUSTED_PROXY_HOPS` | `1` on Cloud Run, else `0` | How many proxies append to `X-Forwarded-For`. Set to `2` if you put a load balancer in front of Cloud Run. |
| `AI_RATE_PER_DAY` | `150` | Gemini calls per running instance per day. |
| `AI_MAX_OUTPUT_TOKENS` | `4096` | Cap on each Gemini answer. |
| `AI_MAX_HISTORY` | `12` | Chat messages sent to Gemini per request. |
| `MAX_UPLOAD_MB` | `5` | Upload size limit. |
| `MAX_CV_CHARS` | `60000` | Size limit of a CV sent to render / export / AI. |

What spends Gemini budget: `POST /api/chat` and parsing with `ai=true`. One request = one Gemini
call. Parsing, rendering, export and `/api/review` never call Gemini. The rate limits are held in
memory, so they are per instance and reset when the instance stops; keep `--max-instances` low
(below) so they stay meaningful, and set a quota on the key in Google AI Studio as the hard stop.

## Abuse protection

In `app/security.py` and `app/guardrails.py`. All of it is in memory, so nothing is stored.

1. **Only the frontend's origin is served.** Every endpoint except `/api/health` rejects requests
   whose `Origin` (or `Referer`) is not in `ALLOWED_ORIGINS` with `403`. This stops other
   websites from using your backend and stops plain `curl`/scripts that do not imitate a browser.
2. **AI calls need a session token.** The UI fetches a signed ticket from `/api/session` and
   sends it as `X-CV-Session`. It expires after 10 minutes and only works from the IP address it
   was issued to, so a copied token is useless elsewhere.
3. **Rate limits per IP address** on every endpoint, a tighter one on uploads, and per-minute,
   per-day and per-instance caps on AI calls. The caller's address is taken from the entry Cloud
   Run appends to `X-Forwarded-For`, so sending a fake header does not reset the limits.
4. **Only CV questions are answered.** Obvious off-topic requests ("write me a poem", "code a
   script") and prompt-injection attempts are refused before Gemini is called. For everything
   else the model must label the request `on_topic`; if it says false, its answer is thrown away
   and the fixed refusal is returned.

**What this cannot do.** A web page cannot keep a secret, so someone who deliberately imitates
the frontend (sends its `Origin`, fetches a token) can still call the API from a script. For them
the rate limits and daily caps are the protection: one address can make at most 40 AI calls a
day, and one instance at most 150. Two further steps close most of the remaining gap and are
worth doing before sharing the URL publicly:

- Set a daily request quota or budget on the Gemini key in Google AI Studio / Cloud console. This
  is the only limit that holds no matter what happens to the backend.
- Add a CAPTCHA-style check (Cloudflare Turnstile is free) in the UI and verify its token in
  `/api/session`. Not implemented; it needs a Turnstile site key and secret.

## AI guardrails

All in `app/guardrails.py`, deterministic, and applied on every request:

- **Model pin.** The only model that can be called is `gemini-3-flash-preview`. `GEMINI_MODEL`
  is checked against an allow-list at startup and again at call time; anything else is ignored
  with a warning in the log. To allow another model, add it to `ALLOWED_MODELS`.
- **Input.** Prompt-injection and "show me your instructions" style messages are refused before
  any Gemini call, so they cost nothing. Messages are capped at 4000 characters and 12 turns.
  The CV is passed as data, and an unknown target id is never placed in the prompt.
- **Output.** Replies and edits are reduced to plain text and capped in length and count. Edits
  must point at ids that exist, stay inside the requested scope on a rewrite, and may not contain
  numbers that are not already in the CV or the user's own messages (no invented metrics). A
  reply that echoes the system prompt is replaced by the refusal. An AI re-parse must reuse the
  document's own words or it is discarded.
- **Provider safety.** A response stopped by Gemini's safety filter becomes `ai_blocked`.
- **Spend.** Thinking level is set to low, output is capped by `AI_MAX_OUTPUT_TOKENS`, and the
  per-minute and per-day limits above apply.

## Deploy to Cloud Run

Prerequisites: `gcloud` installed and logged in, a project with billing, and the Cloud Run,
Cloud Build, Artifact Registry and Secret Manager APIs enabled.

```bash
gcloud config set project YOUR_PROJECT_ID
gcloud services enable run.googleapis.com cloudbuild.googleapis.com \
  artifactregistry.googleapis.com secretmanager.googleapis.com
```

1. Store the key as a secret (once). Type the key when prompted, then Ctrl+D (Ctrl+Z, Enter on
   Windows):

   ```bash
   gcloud secrets create gemini-api-key --data-file=-
   ```

   Allow the Cloud Run service account to read it:

   ```bash
   PROJECT_NUMBER=$(gcloud projects describe YOUR_PROJECT_ID --format='value(projectNumber)')
   gcloud secrets add-iam-policy-binding gemini-api-key \
     --member="serviceAccount:${PROJECT_NUMBER}-compute@developer.gserviceaccount.com" \
     --role="roles/secretmanager.secretAccessor"
   ```

2. Build and deploy from this folder (the Dockerfile is used automatically):

   ```bash
   cd backend
   gcloud run deploy cv-backend \
     --source . \
     --region asia-southeast2 \
     --allow-unauthenticated \
     --min-instances 0 \
     --max-instances 1 \
     --memory 512Mi \
     --cpu 1 \
     --concurrency 20 \
     --timeout 120 \
     --cpu-throttling \
     --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
     --set-env-vars "ALLOWED_ORIGINS=https://YOUR-UI-DOMAIN"
   ```

   - `--min-instances 0` scales to zero: no charge while idle. The first request after idle takes a
     few seconds (cold start). `cloudbuild.yaml` re-applies `--min-instances=0 --cpu-throttling`
     on every deploy, so a change made in the console cannot keep an instance running.
     The UI only calls the API after a user action (no polling, no keep-alive), so a tab left
     open with nothing happening sends no requests and the instance shuts down on its own.
   - `--max-instances 1` caps the bill and keeps the rate limits and session tokens accurate
     (they live in the instance's memory). If you ever raise it, set `SESSION_SECRET` so all
     instances sign tokens with the same key.
   - `ALLOWED_ORIGINS` must be the exact UI origin (scheme + host, no trailing slash). With
     the origin check on, a wrong value blocks the UI completely.
   - `--cpu-throttling` bills CPU only during requests (the cheapest mode).
   - 512Mi is enough: the service idles around 100 MB.
   - Several UI origins: use gcloud's alternate delimiter, e.g.
     `--set-env-vars "^@^ALLOWED_ORIGINS=https://a.example,https://b.example"`.

3. The command prints the service URL. Check it, then give it to the UI as its API base URL
   (`VITE_API_BASE_URL`):

   ```bash
   curl https://cv-backend-XXXX.a.run.app/api/health
   # every other endpoint answers 403 to curl; that is the origin check working
   ```

To update, run the same `gcloud run deploy` again. `--source .` stores the built image in Artifact
Registry (first 0.5 GB free); delete old images there occasionally if you redeploy often.

## AI usage tracking

Every real Gemini call writes one JSON line to stdout. On Cloud Run that becomes a structured
Cloud Logging entry (`jsonPayload`), which is free up to 50 GiB a month and kept for 30 days. Mock
mode and tests write nothing. A record holds metadata only, never CV text, prompts or replies:

```json
{"event":"ai_usage","action":"review","visitor":"3f9c0a1b2c3d4e5f","model":"gemini-3-flash-preview",
 "outcome":"ok","finish_reason":"STOP","input_tokens":5210,"cached_tokens":0,"response_tokens":812,
 "thinking_tokens":340,"output_tokens":1152,"total_tokens":6362,"latency_ms":4180,"est_cost_usd":0.006061}
```

- `action`: `chat`, `rewrite`, `review` or `parse`. `visitor`: salted hash of the client address.
- `outcome`: `ok`, `blocked`, `max_tokens`, `empty`, `provider_rate_limited`, `provider_error` or
  `unreachable`. Failed answers are logged too, because their tokens are still billed.
- `output_tokens` = response + thinking (both billed at the output price). `est_cost_usd` uses the
  price table in `usage.py`; update it when Google changes prices or you add a model.

View it in Logs Explorer with `jsonPayload.event="ai_usage"`, or from a shell:

```bash
gcloud logging read 'jsonPayload.event="ai_usage"' --freshness=7d --format=json
```

**Long-term history in BigQuery (optional, once).** A log sink copies new entries into a dataset;
storage and queries stay inside the BigQuery free tier (10 GB, 1 TB of queries a month) at this
volume. The sink only receives entries from the moment it is created.

```bash
bq --location=asia-southeast2 mk --dataset YOUR_PROJECT_ID:cv_usage
gcloud logging sinks create cv-ai-usage   bigquery.googleapis.com/projects/YOUR_PROJECT_ID/datasets/cv_usage   --use-partitioned-tables   --log-filter='resource.type="cloud_run_revision" AND jsonPayload.event="ai_usage"'
# grant the sink's writer identity (printed by the command above) access to the dataset:
bq add-iam-policy-binding --member='SERVICE_ACCOUNT_PRINTED_ABOVE'   --role=roles/bigquery.dataEditor YOUR_PROJECT_ID:cv_usage
```

Then, for example, daily totals:

```sql
SELECT DATE(timestamp) AS day, jsonPayload.action AS action, COUNT(*) AS calls,
       SUM(jsonPayload.input_tokens) AS input_tokens, SUM(jsonPayload.output_tokens) AS output_tokens,
       ROUND(SUM(jsonPayload.est_cost_usd), 4) AS est_cost_usd,
       COUNT(DISTINCT jsonPayload.visitor) AS visitors
FROM `YOUR_PROJECT_ID.cv_usage.run_googleapis_com_stdout`
GROUP BY day, action ORDER BY day DESC
```

## Notes and limits

- Parsing is rule based (headings, bold lines, dates, bullets). It handles single-column CVs well.
  Multi-column PDFs produce a warning; scanned (image-only) PDFs are rejected because there is no
  OCR. Legacy `.doc` is not supported.
- The PDF uses Liberation Sans / Liberation Serif / Carlito / Caladea, which have the same metrics
  as Arial / Times New Roman / Calibri / Cambria, so line breaks match a preview shown with the
  Office fonts. The DOCX names the Office fonts directly.
