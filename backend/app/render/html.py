"""CV -> one self-contained HTML document (also the source for the PDF)."""

from __future__ import annotations

import re
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup

from ..models import CV
from .common import FONT_STACKS, PAGE_SIZES_MM, prepared, safe_url

_env = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    autoescape=select_autoescape(default=True, default_for_string=True),
    trim_blocks=True,
    lstrip_blocks=True,
)
_env.filters["safe_url"] = safe_url
_env.filters["display_url"] = lambda u: re.sub(r"^(https?://|mailto:)", "", u or "", flags=re.I).rstrip("/")


def render_html(cv: CV) -> str:
    doc = prepared(cv)
    page_w, page_h = PAGE_SIZES_MM[doc.style.page_size]
    return _env.get_template("cv.html.j2").render(
        cv=doc, s=doc.style, page_w=page_w, page_h=page_h, font_stack=Markup(FONT_STACKS[doc.style.font])  # constant, contains quotes
    )
