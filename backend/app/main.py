"""FastAPI entry point. Stateless: no endpoint keeps anything after it returns."""

from __future__ import annotations

import logging
from urllib.parse import quote

from fastapi import Depends, FastAPI, File, Query, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from starlette.exceptions import HTTPException as StarletteHTTPException

from . import ai, security, usage
from .config import Settings, get_settings
from .models import (
    CV,
    ChatRequest,
    ChatResponse,
    ExportRequest,
    ParseResponse,
    ParseTextRequest,
    RenderRequest,
    RenderResponse,
    Review,
    ReviewRequest,
    Section,
    Style,
)
from .parsing.extract import IMPORT_FORMATS, Extracted, ExtractError, extract, lines_from_text
from .parsing.structure import structure
from .render.common import EXPORT_FORMATS, export_basename
from .render.docx import render_docx
from .render.html import render_html
from .render.pdf import PdfUnavailable, count_pages, html_to_pdf, pdf_available
from .review import review_cv

log = logging.getLogger("cv-backend")
settings = get_settings()

app = FastAPI(title="CV Editor API", version="1.0.0")

_OPEN_PATHS = {"/api/health"}


@app.middleware("http")
async def _gatekeeper(request: Request, call_next):
    """Origin check and per-address rate limit for every API call. Registered before
    CORS so that CORS wraps it and rejections still carry CORS headers."""
    path = request.url.path
    if request.method == "OPTIONS" or not path.startswith("/api/") or path in _OPEN_PATHS:
        return await call_next(request)
    cfg = app.dependency_overrides.get(get_settings, get_settings)()
    if cfg.enforce_origin and not security.origin_allowed(request, cfg):
        return _error(403, "forbidden_origin", "This API only accepts requests from the CV editor.")
    ip = security.client_ip(request, cfg.trusted_proxy_hops)
    wait = security.windows.hit(f"all:{ip}", cfg.rate_per_minute, 60)
    if not wait and path == "/api/parse":
        wait = security.windows.hit(f"parse:{ip}", cfg.parse_rate_per_minute, 60)
    if wait:
        return _error(429, "rate_limited", f"Too many requests. Try again in {wait} seconds.", {"Retry-After": str(wait)})
    return await call_next(request)


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["*"],
    expose_headers=["Content-Disposition", "Retry-After"],
    max_age=3600,
)


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, headers: dict | None = None):
        self.status, self.code, self.message, self.headers = status, code, message, headers


def _error(status: int, code: str, message: str, headers: dict | None = None) -> JSONResponse:
    return JSONResponse({"error": {"code": code, "message": message}}, status_code=status, headers=headers)


@app.exception_handler(ApiError)
async def _api_error(_: Request, exc: ApiError):
    return _error(exc.status, exc.code, exc.message, exc.headers)


@app.exception_handler(ExtractError)
async def _extract_error(_: Request, exc: ExtractError):
    status = {"unsupported_format": 415}.get(exc.code, 400)
    return _error(status, exc.code, exc.message)


@app.exception_handler(ai.AIError)
async def _ai_error(_: Request, exc: ai.AIError):
    headers = {"Retry-After": str(exc.retry_after)} if exc.retry_after else None
    return _error(exc.status, exc.code, exc.message, headers)


@app.exception_handler(PdfUnavailable)
async def _pdf_unavailable(_: Request, exc: PdfUnavailable):
    return _error(503, "pdf_unavailable", str(exc))


@app.exception_handler(RequestValidationError)
async def _validation_error(_: Request, exc: RequestValidationError):
    first = exc.errors()[0] if exc.errors() else {}
    where = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
    return _error(422, "validation_error", f"{where}: {first.get('msg', 'invalid value')}" if where else "Invalid request.")


@app.exception_handler(StarletteHTTPException)
async def _http_error(_: Request, exc: StarletteHTTPException):
    code = {404: "not_found", 405: "method_not_allowed"}.get(exc.status_code, "bad_request")
    return _error(exc.status_code, code, str(exc.detail))


@app.exception_handler(Exception)
async def _unhandled(_: Request, exc: Exception):
    # Log the type only: request bodies contain personal data and must not reach the logs.
    log.error("unhandled %s", exc.__class__.__name__)
    return _error(500, "internal_error", "Something went wrong on the server.")


def _guard_ai(request: Request, cfg: Settings) -> None:
    if not cfg.ai_enabled:
        raise ai.AIError("ai_unavailable", "The AI assistant is not configured on this server.", 503)
    ip = security.client_ip(request, cfg.trusted_proxy_hops)
    if not security.token_valid(cfg, request.headers.get("x-cv-session"), ip):
        raise ApiError(401, "invalid_session", "The session has expired. Refresh and try again.")
    usage.bind(visitor=usage.visitor(ip))
    if cfg.ai_mock:
        return
    wait = security.windows.hit(f"ai-day:{ip}", cfg.ai_rate_per_ip_day, 86400)
    if wait:
        raise ai.AIError("rate_limited", "You have reached today's AI limit. Try again tomorrow.", 429, wait)
    ai.limiter.check(ip, cfg.ai_rate_per_minute, cfg.ai_rate_per_day)


def _guard_size(cv: CV, cfg: Settings) -> None:
    if len(cv.model_dump_json()) > cfg.max_cv_chars:
        raise ApiError(413, "cv_too_large", "This CV is too large to process.")


def _blank_cv() -> CV:
    return CV(
        sections=[
            Section(type="summary", title="Summary", show_title=False),
            Section(type="experience", title="Experience"),
            Section(type="education", title="Education"),
            Section(type="skills", title="Skills"),
        ]
    )


def _build(extracted: Extracted, use_ai: bool, request: Request, cfg: Settings) -> ParseResponse:
    raw_text = extracted.raw_text
    cv, warnings = structure(extracted.lines, extracted.style)
    warnings = extracted.warnings + warnings
    parser = "heuristic"
    if use_ai:
        _guard_ai(request, cfg)
        if cfg.ai_mock:
            warnings.append("Mock mode: the AI re-parse returned the rule-based result.")
        else:
            style = cv.style
            cv = ai.parse_with_ai(raw_text[: cfg.max_cv_chars], cfg)
            cv.style = style
            warnings = list(extracted.warnings)
        parser = "ai"
    return ParseResponse(cv=cv, raw_text=raw_text, warnings=warnings, parser=parser, source_format=extracted.fmt)


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok"}


@app.get("/api/session")
def session(request: Request, cfg: Settings = Depends(get_settings)) -> dict:
    token, ttl = security.issue_token(cfg, security.client_ip(request, cfg.trusted_proxy_hops))
    return {"token": token, "expires_in": ttl}


@app.get("/api/meta")
def meta(cfg: Settings = Depends(get_settings)) -> dict:
    return {
        "import_formats": IMPORT_FORMATS,
        "export_formats": EXPORT_FORMATS,
        "max_upload_bytes": cfg.max_upload_bytes,
        "ai_enabled": cfg.ai_enabled,
        "ai_mock": cfg.ai_mock,
        "ai_model": cfg.gemini_model,
        "pdf_available": pdf_available(),
        "section_types": list(Section.model_fields["type"].annotation.__args__),
        "fonts": list(Style.model_fields["font"].annotation.__args__),
        "blank_cv": _blank_cv().model_dump(),
    }


@app.post("/api/parse", response_model=ParseResponse)
async def parse_file(
    request: Request,
    file: UploadFile = File(...),
    use_ai: bool = Query(False, alias="ai"),
    cfg: Settings = Depends(get_settings),
) -> ParseResponse:
    data = await file.read(cfg.max_upload_bytes + 1)
    await file.close()
    if len(data) > cfg.max_upload_bytes:
        raise ApiError(413, "file_too_large", f"The file is larger than {cfg.max_upload_bytes // (1024 * 1024)} MB.")
    if not data:
        raise ApiError(400, "empty_document", "The uploaded file is empty.")
    extracted = await run_in_threadpool(extract, file.filename or "upload", data)
    del data
    return await run_in_threadpool(_build, extracted, use_ai, request, cfg)


@app.post("/api/parse/text", response_model=ParseResponse)
def parse_text(body: ParseTextRequest, request: Request, cfg: Settings = Depends(get_settings)) -> ParseResponse:
    if not body.text.strip():
        raise ApiError(400, "empty_document", "There is no text to parse.")
    if len(body.text) > cfg.max_cv_chars:
        raise ApiError(413, "cv_too_large", "This text is too large to process.")
    return _build(Extracted(lines_from_text(body.text), "txt"), body.ai, request, cfg)


@app.post("/api/render", response_model=RenderResponse)
def render(body: RenderRequest, cfg: Settings = Depends(get_settings)) -> RenderResponse:
    _guard_size(body.cv, cfg)
    html = render_html(body.cv)
    pages = count_pages(html) if body.page_count and pdf_available() else None
    return RenderResponse(html=html, page_count=pages)


_MEDIA = {
    "pdf": "application/pdf",
    "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "html": "text/html; charset=utf-8",
}


@app.post("/api/export")
def export(body: ExportRequest, cfg: Settings = Depends(get_settings)) -> Response:
    _guard_size(body.cv, cfg)
    if body.format == "docx":
        content = render_docx(body.cv)
    else:
        html = render_html(body.cv)
        content = html_to_pdf(html) if body.format == "pdf" else html.encode("utf-8")
    name = f"{export_basename(body.cv, body.filename)}.{body.format}"
    return Response(
        content,
        media_type=_MEDIA[body.format],
        headers={
            "Content-Disposition": f"attachment; filename=\"{name}\"; filename*=UTF-8''{quote(name)}",
            "Cache-Control": "no-store",
        },
    )


@app.post("/api/review", response_model=Review)
def review(body: ReviewRequest, cfg: Settings = Depends(get_settings)) -> Review:
    _guard_size(body.cv, cfg)
    return review_cv(body.cv)


@app.post("/api/chat", response_model=ChatResponse)
def chat(body: ChatRequest, request: Request, cfg: Settings = Depends(get_settings)) -> ChatResponse:
    _guard_size(body.cv, cfg)
    _guard_ai(request, cfg)
    return ai.chat(body, cfg)
