"""CV document schema shared by parse, render, export and AI endpoints.

The browser is the source of truth for a CV: every endpoint receives the full
document and returns a result, nothing is stored server-side.
"""

from __future__ import annotations

import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


def new_id(prefix: str) -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


class Model(BaseModel):
    # Unknown fields are dropped rather than rejected so an older/newer UI
    # build never gets a 422 for sending something extra.
    model_config = ConfigDict(extra="ignore")


class Bullet(Model):
    id: str = Field(default_factory=lambda: new_id("blt"))
    text: str = ""


class Contact(Model):
    id: str = Field(default_factory=lambda: new_id("ctc"))
    kind: Literal["phone", "email", "location", "linkedin", "github", "website", "other"] = "other"
    text: str = ""
    url: str | None = None


class Header(Model):
    name: str = ""
    headline: str = ""
    contacts: list[Contact] = Field(default_factory=list)


class Item(Model):
    id: str = Field(default_factory=lambda: new_id("itm"))
    title: str = ""
    subtitle: str = ""
    date: str = ""
    location: str = ""
    # Plain detail lines rendered without a bullet glyph (e.g. "GPA : 3.51/4").
    lines: list[Bullet] = Field(default_factory=list)
    bullets: list[Bullet] = Field(default_factory=list)


SectionType = Literal[
    "summary",
    "experience",
    "education",
    "projects",
    "skills",
    "certifications",
    "organizations",
    "volunteer",
    "awards",
    "languages",
    "publications",
    "custom",
]


class Section(Model):
    id: str = Field(default_factory=lambda: new_id("sec"))
    type: SectionType = "custom"
    title: str = ""
    title_url: str | None = None
    show_title: bool = True
    visible: bool = True
    # Every content field is rendered when non-empty, whatever the type;
    # `type` is only a semantic hint for the UI and the AI.
    text: str = ""
    bullets: list[Bullet] = Field(default_factory=list)
    items: list[Item] = Field(default_factory=list)


class Style(Model):
    page_size: Literal["A4", "Letter"] = "A4"
    margin_mm: float = Field(default=12.7, ge=5, le=30)
    font: Literal["arial", "calibri", "times", "cambria"] = "arial"
    font_size_pt: float = Field(default=10, ge=7, le=13)
    line_height: float = Field(default=1.3, ge=1.0, le=2.0)
    accent_color: str = "#111111"
    heading_style: Literal["rule", "plain"] = "rule"
    name_align: Literal["left", "center"] = "left"
    text_align: Literal["left", "justify"] = "left"
    # Trailing-period policy applied to every bullet at render/export time.
    bullet_period: Literal["keep", "add", "remove"] = "keep"

    @field_validator("accent_color")
    @classmethod
    def _hex_color(cls, v: str) -> str:
        v = v.strip()
        if len(v) in (4, 7) and v.startswith("#") and all(c in "0123456789abcdefABCDEF" for c in v[1:]):
            return v
        raise ValueError("accent_color must be a hex color like #1a2b3c")


class CV(Model):
    version: int = 1
    header: Header = Field(default_factory=Header)
    sections: list[Section] = Field(default_factory=list)
    style: Style = Field(default_factory=Style)


# ---------------------------------------------------------------- API bodies


class ParseTextRequest(Model):
    text: str
    ai: bool = False


class ParseResponse(Model):
    cv: CV
    raw_text: str
    warnings: list[str] = Field(default_factory=list)
    parser: Literal["heuristic", "ai"] = "heuristic"
    source_format: str = ""


class RenderRequest(Model):
    cv: CV
    page_count: bool = True


class RenderResponse(Model):
    html: str
    page_count: int | None = None


class PagesRequest(Model):
    cv: CV


class PagesResponse(Model):
    page_count: int | None = None


class ExportRequest(Model):
    cv: CV
    format: Literal["pdf", "docx", "html"]
    filename: str | None = None


class Finding(Model):
    target_id: str | None = None
    severity: Literal["info", "warn", "error"] = "info"
    code: str = ""
    message: str = ""


class Scores(Model):
    star: int = Field(default=0, ge=0, le=100)
    concision: int = Field(default=0, ge=0, le=100)
    impact: int = Field(default=0, ge=0, le=100)
    overall: int = Field(default=0, ge=0, le=100)


class Review(Model):
    scores: Scores = Field(default_factory=Scores)
    summary: str = ""
    findings: list[Finding] = Field(default_factory=list)


class ReviewRequest(Model):
    cv: CV


EditOp = Literal["replace", "add_bullet", "remove"]


class Edit(Model):
    id: str = Field(default_factory=lambda: new_id("edt"))
    op: EditOp = "replace"
    target_id: str
    field: str = "text"
    before: str = ""
    after: str = ""
    reason: str = ""


class ChatMessage(Model):
    role: Literal["user", "assistant"]
    content: str


class ChatRequest(Model):
    cv: CV
    messages: list[ChatMessage] = Field(default_factory=list)
    target_id: str | None = None
    action: Literal["chat", "rewrite", "review"] = "chat"


class ChatResponse(Model):
    reply: str
    edits: list[Edit] = Field(default_factory=list)
    review: Review | None = None
    mock: bool = False
