"""Normalisation shared by every output format so preview, PDF, DOCX and HTML agree."""

from __future__ import annotations

import re

from ..models import CV, Bullet

EXPORT_FORMATS = ["pdf", "docx", "html"]

# CSS stacks pair each Office font with its metric-compatible open font, which is
# what the Cloud Run image has installed, so line breaks match across machines.
FONT_STACKS = {
    "arial": "Arial, 'Liberation Sans', Arimo, Helvetica, sans-serif",
    "calibri": "Calibri, Carlito, 'Liberation Sans', sans-serif",
    "times": "'Times New Roman', 'Liberation Serif', Tinos, Times, serif",
    "cambria": "Cambria, Caladea, 'Liberation Serif', Georgia, serif",
}
DOCX_FONTS = {"arial": "Arial", "calibri": "Calibri", "times": "Times New Roman", "cambria": "Cambria"}
PAGE_SIZES_MM = {"A4": (210.0, 297.0), "Letter": (215.9, 279.4)}


def apply_period(text: str, policy: str) -> str:
    text = text.strip()
    if not text or policy == "keep":
        return text
    if policy == "add":
        return text if text[-1] in ".!?:;" else text + "."
    if text.endswith(".") and not text.endswith(".."):
        return text[:-1].rstrip()
    return text


def _bullets(bullets: list[Bullet], policy: str) -> list[Bullet]:
    out = []
    for b in bullets:
        text = apply_period(re.sub(r"\s+", " ", b.text), policy)
        if text:
            out.append(Bullet(id=b.id, text=text))
    return out


def prepared(cv: CV) -> CV:
    """Copy of the CV exactly as it should be drawn: hidden sections and empty
    entries dropped, bullet period policy applied."""
    doc = cv.model_copy(deep=True)
    policy = doc.style.bullet_period
    doc.header.contacts = [c for c in doc.header.contacts if c.text.strip()]
    doc.sections = [s for s in doc.sections if s.visible]
    for sec in doc.sections:
        sec.bullets = _bullets(sec.bullets, policy)
        for item in sec.items:
            item.bullets = _bullets(item.bullets, policy)
            item.lines = _bullets(item.lines, "keep")
        sec.items = [
            i for i in sec.items if i.title or i.subtitle or i.date or i.location or i.lines or i.bullets
        ]
    return doc


def safe_url(url: str | None) -> str | None:
    if url and re.match(r"^(https?://|mailto:|tel:)", url.strip(), re.I):
        return url.strip()
    return None


def export_basename(cv: CV, requested: str | None) -> str:
    base = requested or (f"CV_{cv.header.name}" if cv.header.name.strip() else "CV")
    base = re.sub(r"\.(pdf|docx|html?)$", "", base.strip(), flags=re.I)
    base = re.sub(r"[^\w\- ]+", "", base, flags=re.ASCII).strip().replace(" ", "_")
    return base[:80] or "CV"
