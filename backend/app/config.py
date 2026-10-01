"""Runtime settings, read from environment variables only."""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

from .guardrails import resolve_model

_BACKEND_DIR = Path(__file__).resolve().parent.parent

# Local development convenience: backend/.env first, then the repo-root .env.
# On Cloud Run neither file exists and real environment variables are used.
load_dotenv(_BACKEND_DIR / ".env")
load_dotenv(_BACKEND_DIR.parent / ".env")


def _int(name: str, default: int) -> int:
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


def _bool(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in ("1", "true", "yes", "on")


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str = field(default_factory=lambda: os.environ.get("GEMINI_API_KEY", "").strip(), repr=False)
    # Always resolved through the allow-list in guardrails.py.
    gemini_model: str = field(default_factory=lambda: resolve_model(os.environ.get("GEMINI_MODEL")))
    # AI_MOCK=1 returns canned AI answers without calling Gemini (free).
    ai_mock: bool = field(default_factory=lambda: _bool("AI_MOCK"))
    ai_max_output_tokens: int = field(default_factory=lambda: _int("AI_MAX_OUTPUT_TOKENS", 4096))
    ai_rate_per_minute: int = field(default_factory=lambda: _int("AI_RATE_PER_MINUTE", 8))
    ai_rate_per_day: int = field(default_factory=lambda: _int("AI_RATE_PER_DAY", 150))
    ai_rate_per_ip_day: int = field(default_factory=lambda: _int("AI_RATE_PER_IP_DAY", 40))
    # Every /api call, per client address.
    rate_per_minute: int = field(default_factory=lambda: _int("RATE_PER_MINUTE", 90))
    parse_rate_per_minute: int = field(default_factory=lambda: _int("PARSE_RATE_PER_MINUTE", 12))
    # Reject calls that do not come from an allowed browser origin.
    enforce_origin: bool = field(default_factory=lambda: _bool("ENFORCE_ORIGIN", True))
    session_secret: str = field(default_factory=lambda: os.environ.get("SESSION_SECRET", "").strip(), repr=False)
    session_ttl_seconds: int = field(default_factory=lambda: _int("SESSION_TTL_SECONDS", 600))
    # Proxies in front of the app that append to X-Forwarded-For (Cloud Run = 1, none locally).
    trusted_proxy_hops: int = field(default_factory=lambda: _int("TRUSTED_PROXY_HOPS", 1 if os.environ.get("K_SERVICE") else 0))
    ai_max_history: int = field(default_factory=lambda: _int("AI_MAX_HISTORY", 12))
    ai_max_message_chars: int = field(default_factory=lambda: _int("AI_MAX_MESSAGE_CHARS", 4000))
    max_upload_bytes: int = field(default_factory=lambda: _int("MAX_UPLOAD_MB", 5) * 1024 * 1024)
    max_cv_chars: int = field(default_factory=lambda: _int("MAX_CV_CHARS", 60000))
    allowed_origins: list[str] = field(
        default_factory=lambda: [
            o.strip()
            for o in os.environ.get("ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
            if o.strip()
        ]
    )

    @property
    def ai_enabled(self) -> bool:
        return self.ai_mock or bool(self.gemini_api_key)


def get_settings() -> Settings:
    return Settings()
