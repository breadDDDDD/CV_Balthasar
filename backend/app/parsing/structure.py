"""Rule-based CV structuring: flat lines -> header, sections, items, bullets."""

from __future__ import annotations

import re
from collections import Counter

from ..models import CV, Bullet, Contact, Header, Item, Section, Style
from .extract import Line

_GLYPHS = "•●○◦▪■□▫◆◇‣⁃∙·➢➤►▶✓✔"
BULLET_RE = re.compile(rf"^\s*(?:[{_GLYPHS}]|[-–—*](?=\s))\s*")

_LIGATURES = {"ﬁ": "fi", "ﬂ": "fl", "ﬀ": "ff", "ﬃ": "ffi", "ﬄ": "ffl", " ": " ", " ": " ", " ": " "}
_INVISIBLE = re.compile("[­​‌‍⁠﻿]")

_MONTH = r"(?:jan|feb|mar|apr|may|jun|jul|aug|sept|sep|oct|nov|dec)[a-z]*\.?"
_POINT = rf"(?:(?:{_MONTH}\s+)?(?:19|20)\d{{2}}|\d{{1,2}}/(?:19|20)\d{{2}})"
_END = rf"(?:{_POINT}|now|present|current|ongoing|today)"
_RANGE = rf"{_POINT}\s*(?:-|–|—|to|until)\s*{_END}"
DATE_TAIL_RE = re.compile(rf"(?:^|(?<=[\s,|(]))\(?((?:{_RANGE})|(?:{_POINT}))\)?\s*$", re.I)

EMAIL_RE = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
URL_RE = re.compile(r"(?:https?://|www\.)\S+|\b[\w-]+(?:\.[\w-]+)*\.(?:com|org|net|io|dev|app|me|id|ai|co)(?:/\S*)?", re.I)
PHONE_RE = re.compile(r"^\+?[\d\s().-]{8,}$")
_CONTACT_SPLIT = re.compile(r"\s*(?:\||•|·|◆|\s{3,})\s*")

# Order matters: "Organizational Experiences" must not be classified as experience.
_TYPE_KEYWORDS = [
    ("summary", ("summary", "profile", "about me", "objective")),
    ("organizations", ("organi", "leadership", "extracurricular", "activities")),
    ("volunteer", ("volunteer", "community")),
    ("certifications", ("certif", "course", "training", "licen")),
    ("education", ("education", "academic")),
    ("experience", ("experience", "employment", "work history", "career")),
    ("projects", ("project", "portfolio", "portofolio")),
    ("skills", ("skill", "technolog", "competenc", "tools")),
    ("awards", ("award", "honor", "honour", "achievement")),
    ("languages", ("language",)),
    ("publications", ("publication", "research")),
]


def clean_text(text: str) -> str:
    for src, dst in _LIGATURES.items():
        text = text.replace(src, dst)
    text = _INVISIBLE.sub("", text)
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"\s+([.,])(?=\s|$)", r"\1", text)
    text = re.sub(r"(?<!\.)\.\.(?!\.)", ".", text)
    return text


def split_trailing_date(text: str) -> tuple[str, str]:
    m = DATE_TAIL_RE.search(text)
    if not m:
        return text, ""
    rest = text[: m.start()].rstrip(" ,|-–—(\t")
    return rest, clean_text(m.group(1))


def section_type(title: str) -> str:
    low = title.lower()
    for kind, keys in _TYPE_KEYWORDS:
        if any(k in low for k in keys):
            return kind
    return "custom"


def _contact(piece: str, urls: list[str]) -> Contact:
    low = piece.lower()
    email = EMAIL_RE.search(piece)
    if email:
        return Contact(kind="email", text=piece, url=f"mailto:{email.group(0)}")
    url = URL_RE.search(piece)
    if url:
        href = url.group(0).rstrip(".,;)")
        match = next((u for u in urls if href.lower().split("//")[-1] in u.lower()), None)
        if not href.lower().startswith("http"):
            href = "https://" + href
        kind = "linkedin" if "linkedin" in low else "github" if "github" in low else "website"
        return Contact(kind=kind, text=piece, url=match or href)
    if PHONE_RE.match(piece) and sum(c.isdigit() for c in piece) >= 8:
        return Contact(kind="phone", text=piece)
    return Contact(kind="location", text=piece)


def _looks_like_contact(text: str) -> bool:
    if EMAIL_RE.search(text) or URL_RE.search(text) or "|" in text:
        return True
    return any(PHONE_RE.match(p) and sum(c.isdigit() for c in p) >= 8 for p in _CONTACT_SPLIT.split(text))


class _Doc:
    """Layout facts measured once over the whole document."""

    def __init__(self, lines: list[Line]):
        sizes = Counter()
        for ln in lines:
            if ln.size:
                sizes[ln.size] += len(ln.text)
        self.body_size = sizes.most_common(1)[0][0] if sizes else None
        self.has_bold = any(ln.bold is not None for ln in lines)
        self.right = max((ln.x1 for ln in lines if ln.x1 is not None), default=None)

    def is_heading(self, ln: Line, index: int) -> bool:
        if ln.heading:
            return index > 0
        text = ln.text
        if index == 0 or BULLET_RE.match(text) or ln.bullet or len(text) > 70:
            return False
        if self.body_size and ln.size and ln.size >= self.body_size * 1.15:
            return True
        words = text.split()
        if len(words) > 5 or ln.bold is False or re.search(r"\d", text):
            return False
        bare = re.sub(r"\[.*?\]|[:\-–—_=\s]+$", "", text).strip()
        if re.search(r"[:,|@]", bare):  # "Languages: Python, SQL" is content, not a heading
            return False
        if section_type(bare) != "custom" and not DATE_TAIL_RE.search(text):
            return True
        return bare.isupper() and len(bare) >= 4

    def wrapped(self, ln: Line) -> bool:
        """True when the line runs to the right margin, so the next one continues it."""
        return self.right is not None and ln.x1 is not None and ln.x1 >= self.right * 0.93


def _join(prev: str, nxt: str) -> str:
    return f"{prev} {nxt}".strip()


def structure(lines: list[Line], style_hints: dict | None = None) -> tuple[CV, list[str]]:
    warnings: list[str] = []
    lines = [ln for ln in lines if clean_text(ln.text)]
    for ln in lines:
        ln.text = ln.text.strip()
    doc = _Doc(lines)

    heading_idx = [i for i, ln in enumerate(lines) if doc.is_heading(ln, i)]
    first_heading = heading_idx[0] if heading_idx else len(lines)

    header, summary = _header(lines[:first_heading], doc)
    sections: list[Section] = []
    if summary:
        sections.append(Section(type="summary", title="Summary", show_title=False, text=summary))
    bounds = heading_idx + [len(lines)]
    for start, end in zip(bounds, bounds[1:]):
        sections.append(_section(lines[start], lines[start + 1 : end], doc))

    if not header.name:
        warnings.append("Could not find a name at the top of the document.")
    if not heading_idx:
        warnings.append("No section headings were recognised; all content was placed in the summary. Try the AI re-parse.")
    for sec in sections:
        if sec.show_title and not (sec.text or sec.bullets or sec.items):
            warnings.append(f'Section "{sec.title}" appears to be empty.')

    try:
        style = Style(**_clamp_style(style_hints or {}))
    except ValueError:
        style = Style()
    return CV(header=header, sections=sections, style=style), warnings


def _clamp_style(hints: dict) -> dict:
    out = dict(hints)
    if "margin_mm" in out:
        out["margin_mm"] = min(30.0, max(5.0, float(out["margin_mm"])))
    if "font_size_pt" in out:
        out["font_size_pt"] = min(13.0, max(7.0, float(out["font_size_pt"])))
    return out


def _header(lines: list[Line], doc: _Doc) -> tuple[Header, str]:
    header = Header()
    if not lines:
        return header, ""
    header.name = clean_text(lines[0].text)
    summary = ""
    prev: Line | None = None
    for i, ln in enumerate(lines[1:], start=1):
        text = clean_text(BULLET_RE.sub("", ln.text))
        if not summary and _looks_like_contact(text) and len(text) < 160:
            for piece in _CONTACT_SPLIT.split(text):
                if piece:
                    header.contacts.append(_contact(piece, ln.urls))
        elif i == 1 and len(text) <= 80 and not text.endswith("."):
            header.headline = text
        else:
            summary = _join(summary, text) if not summary or prev is None or doc.right is None or doc.wrapped(prev) else f"{summary}\n{text}"
            prev = ln
    return header, summary


def _section(head: Line, body: list[Line], doc: _Doc) -> Section:
    title = clean_text(head.text).rstrip(":").strip()
    title_url = head.urls[0] if head.urls else None
    bracket = re.search(r"[\[(]\s*(\S+\.\S+)\s*[\])]\s*$", title)
    if bracket:
        title = title[: bracket.start()].strip()
        if not title_url:
            link = bracket.group(1)
            title_url = link if link.lower().startswith("http") else "https://" + link
    sec = Section(type=section_type(title), title=title, title_url=title_url)

    item: Item | None = None
    # What a following continuation line would be appended to, and how.
    last_bullet: Bullet | None = None
    last_bullet_x: float | None = None
    last_plain: Bullet | None = None
    prev: Line | None = None

    for ln in body:
        glyph = BULLET_RE.match(ln.text)
        text = clean_text(ln.text[glyph.end() :] if glyph else ln.text)
        if not text:
            continue

        if glyph or ln.bullet:
            last_bullet = Bullet(text=text)
            last_bullet_x = ln.x0
            last_plain = None
            (item.bullets if item else sec.bullets).append(last_bullet)
            prev = ln
            continue

        if last_bullet is not None and ln.x0 is not None and last_bullet_x is not None and ln.x0 > last_bullet_x + 1:
            last_bullet.text = clean_text(_join(last_bullet.text, text))
            prev = ln
            continue
        last_bullet = None

        rest, date = split_trailing_date(text)
        is_title = sec.type != "summary" and (
            ln.bold is True or ((not doc.has_bold or item is None) and bool(date) and bool(rest))
        )
        if is_title:
            if ln.bold is True and item and not item.subtitle and not item.lines and not item.bullets and not date:
                item.subtitle = text
            else:
                item = Item(title=rest, date=date)
                sec.items.append(item)
            last_plain = None
        elif item is None:
            # Without geometry only a summary is assumed to be one flowing paragraph.
            flowing = sec.type == "summary" if doc.right is None else prev is not None and doc.wrapped(prev)
            joined = sec.text and flowing
            sec.text = _join(sec.text, text) if joined or not sec.text else f"{sec.text}\n{text}"
        elif date and not rest and not item.date:
            item.date = date
        elif not item.subtitle and not item.lines and not item.bullets and len(text) <= 70 and ":" not in text:
            item.subtitle = rest if date and not item.date else text
            if date and not item.date:
                item.date = date
        elif last_plain is not None and prev is not None and doc.wrapped(prev):
            last_plain.text = clean_text(_join(last_plain.text, text))
        else:
            last_plain = Bullet(text=text)
            item.lines.append(last_plain)
        prev = ln
    return sec
