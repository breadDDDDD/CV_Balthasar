"""Turn an uploaded file into a flat list of text lines with layout hints.

Everything works on in-memory bytes; nothing is written to disk.
"""

from __future__ import annotations

import io
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field

IMPORT_FORMATS = ["pdf", "docx", "txt", "md", "rtf", "odt"]


class ExtractError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass
class Line:
    text: str
    bold: bool | None = None  # None = the format carries no weight information
    size: float | None = None  # pt
    x0: float | None = None  # left edge (pt for PDF, leading-space count for text)
    x1: float | None = None  # right edge (PDF only)
    heading: bool = False  # explicit heading markup (docx style, markdown #, odt h)
    bullet: bool = False  # explicit list markup (docx/odt lists)
    urls: list[str] = field(default_factory=list)


@dataclass
class Extracted:
    lines: list[Line]
    fmt: str
    style: dict = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    @property
    def raw_text(self) -> str:
        return "\n".join(("• " if ln.bullet else "") + ln.text for ln in self.lines)


def detect_format(filename: str, data: bytes) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext == "markdown":
        ext = "md"
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:5] == b"{\\rtf":
        return "rtf"
    if data[:2] == b"PK":
        try:
            names = zipfile.ZipFile(io.BytesIO(data)).namelist()
        except zipfile.BadZipFile:
            raise ExtractError("bad_request", "The file is corrupted and cannot be opened.")
        if "word/document.xml" in names:
            return "docx"
        if "content.xml" in names:
            return "odt"
        raise ExtractError("unsupported_format", "This archive is not a DOCX or ODT document.")
    if data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise ExtractError("unsupported_format", "Legacy .doc files are not supported. Save it as .docx or .pdf first.")
    if ext in ("txt", "md"):
        return ext
    if ext in IMPORT_FORMATS or b"\x00" in data[:2048]:
        raise ExtractError("unsupported_format", f"The content of this file does not look like a .{ext or '?'} document.")
    if ext == "":
        return "txt"
    raise ExtractError("unsupported_format", f".{ext} files are not supported. Use one of: {', '.join(IMPORT_FORMATS)}.")


def extract(filename: str, data: bytes) -> Extracted:
    fmt = detect_format(filename, data)
    try:
        result = _EXTRACTORS[fmt](data)
    except ExtractError:
        raise
    except Exception as exc:  # a broken document must never take the server down
        raise ExtractError("bad_request", f"Could not read this {fmt.upper()} file: {exc.__class__.__name__}.")
    result.lines = [ln for ln in result.lines if ln.text.strip()]
    if not result.lines:
        hint = " It may be a scanned image; export it from a text source instead." if fmt == "pdf" else ""
        raise ExtractError("empty_document", "No text could be extracted from this file." + hint)
    return result


def lines_from_text(text: str, markdown: bool = False) -> list[Line]:
    lines: list[Line] = []
    for raw in text.replace("\r\n", "\n").replace("\r", "\n").split("\n"):
        expanded = raw.expandtabs(4)
        stripped = expanded.strip()
        if not stripped:
            continue
        ln = Line(text=stripped, x0=float(len(expanded) - len(expanded.lstrip())))
        if markdown:
            m = re.match(r"^#{1,6}\s+(.*?)\s*#*$", stripped)
            if m:
                ln.text, ln.heading = m.group(1), True
            if re.fullmatch(r"(\*\*|__).+\1", ln.text):
                ln.bold = True
            ln.text = re.sub(r"\[([^\]]+)\]\((?:[^)]+)\)", r"\1", ln.text)
            ln.text = re.sub(r"(\*\*|__)(.+?)\1", r"\2", ln.text)
            if re.fullmatch(r"[-*_]{3,}", ln.text):
                continue
        lines.append(ln)
    return lines


def _decode(data: bytes) -> str:
    try:
        if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
            return data.decode("utf-16")
        return data.decode("utf-8-sig")
    except UnicodeError:
        return data.decode("cp1252", errors="replace")


def _txt(data: bytes) -> Extracted:
    return Extracted(lines_from_text(_decode(data)), "txt")


def _md(data: bytes) -> Extracted:
    return Extracted(lines_from_text(_decode(data), markdown=True), "md")


def _rtf(data: bytes) -> Extracted:
    from striprtf.striprtf import rtf_to_text

    return Extracted(lines_from_text(rtf_to_text(data.decode("latin-1"), errors="ignore")), "rtf")


_BOLD_FONT = re.compile(r"bold|black|heavy|semibold|demi", re.I)


def _font_key(fontname: str) -> str:
    name = fontname.lower()
    if "times" in name or "tinos" in name or "liberationserif" in name:
        return "times"
    if "calibri" in name or "carlito" in name:
        return "calibri"
    if "cambria" in name or "caladea" in name or "georgia" in name or "garamond" in name:
        return "cambria"
    return "arial"


def _pdf(data: bytes) -> Extracted:
    import pdfplumber

    from .structure import split_trailing_date  # local import: structure imports this module

    lines: list[Line] = []
    sizes: Counter[float] = Counter()
    fonts: Counter[str] = Counter()
    warnings: list[str] = []
    style: dict = {}
    with pdfplumber.open(io.BytesIO(data)) as pdf:
        if len(pdf.pages) > 12:
            raise ExtractError("bad_request", "This PDF has more than 12 pages, which is too long for a CV.")
        for page in pdf.pages:
            links = [(h["top"], h["bottom"], h.get("uri")) for h in page.hyperlinks if h.get("uri")]
            for row in page.extract_text_lines(return_chars=True, strip=True):
                chars = [c for c in row["chars"] if c["text"].strip()]
                if not chars:
                    continue
                # Size of the leading text: a heading may carry a smaller trailing link.
                size = Counter(round(c["size"], 1) for c in chars[:5]).most_common(1)[0][0]
                # A right-aligned date is often regular weight next to a bold title,
                # so weight is judged on the text before it.
                rest = split_trailing_date(row["text"])[0]
                lead = chars[: len(rest.replace(" ", ""))] or chars
                bold = sum(1 for c in lead if _BOLD_FONT.search(c["fontname"])) > len(lead) / 2
                mid = (row["top"] + row["bottom"]) / 2
                lines.append(
                    Line(
                        text=row["text"],
                        bold=bold,
                        size=size,
                        x0=row["x0"],
                        x1=row["x1"],
                        urls=[u for top, bottom, u in links if top - 1 <= mid <= bottom + 1],
                    )
                )
                sizes[size] += len(chars)
                fonts[_font_key(chars[0]["fontname"])] += len(chars)
        if pdf.pages and lines:
            first = pdf.pages[0]
            style["page_size"] = "Letter" if abs(first.width - 612) < 3 else "A4"
            style["margin_mm"] = round(min(ln.x0 for ln in lines) * 25.4 / 72, 1)
            style["font_size_pt"] = sizes.most_common(1)[0][0]
            style["font"] = fonts.most_common(1)[0][0]
            # A second column starting past the middle means reading order is unreliable.
            starts = Counter(round(ln.x0 / 10) for ln in lines)
            if any(col * 10 > first.width * 0.45 and n >= 5 for col, n in starts.items()):
                warnings.append("This PDF seems to use a multi-column layout; check that sections were split correctly.")
    return Extracted(lines, "pdf", style, warnings)


def _docx(data: bytes) -> Extracted:
    import docx
    from docx.table import Table
    from docx.text.paragraph import Paragraph

    document = docx.Document(io.BytesIO(data))
    lines: list[Line] = []
    sizes: Counter[float] = Counter()

    def style_chain(style):
        while style is not None:
            yield style
            style = style.base_style

    def add(par: Paragraph) -> None:
        if not par.text.strip():
            return
        style_name = (par.style.name or "") if par.style is not None else ""
        style_bold = next((s.font.bold for s in style_chain(par.style) if s.font.bold is not None), False)
        style_size = next((s.font.size.pt for s in style_chain(par.style) if s.font.size is not None), None)
        runs = [r for r in par.runs if r.text.strip()]
        bold = bool(runs) and all(r.bold if r.bold is not None else style_bold for r in runs)
        run_sizes = [r.font.size.pt for r in runs if r.font.size is not None]
        size = Counter(run_sizes).most_common(1)[0][0] if run_sizes else style_size
        numbered = par._p.pPr is not None and par._p.pPr.numPr is not None
        for part in par.text.split("\n"):
            text = part.replace("\t", "   ").strip()
            if not text:
                continue
            lines.append(
                Line(
                    text=text,
                    bold=bold,
                    size=size,
                    heading=style_name.lower().startswith("heading"),
                    bullet=numbered or style_name.lower().startswith("list"),
                )
            )
            if size:
                sizes[size] += len(text)

    def walk(parent) -> None:
        for child in parent.iterchildren():
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "p":
                add(Paragraph(child, document))
            elif tag == "tbl":
                for row in Table(child, document).rows:
                    seen = set()
                    for cell in row.cells:
                        if id(cell._tc) in seen:
                            continue
                        seen.add(id(cell._tc))
                        walk(cell._tc)
            elif tag == "sdt":
                for content in child.iterchildren():
                    if content.tag.endswith("}sdtContent"):
                        walk(content)

    walk(document.element.body)
    style: dict = {}
    section = document.sections[0] if document.sections else None
    if section is not None and section.page_width and section.left_margin is not None:
        style["page_size"] = "Letter" if abs(section.page_width.pt - 612) < 3 else "A4"
        style["margin_mm"] = round(section.left_margin.mm, 1)
    if sizes:
        style["font_size_pt"] = sizes.most_common(1)[0][0]
    return Extracted(lines, "docx", style)


def _odt(data: bytes) -> Extracted:
    from odf import teletype
    from odf.opendocument import load

    document = load(io.BytesIO(data))
    lines: list[Line] = []

    def walk(node, in_list: bool) -> None:
        for child in node.childNodes:
            name = getattr(child, "qname", (None, None))[1]
            if name in ("p", "h"):
                first = True
                for part in teletype.extractText(child).split("\n"):
                    text = part.replace("\t", "   ").strip()
                    if text:
                        lines.append(Line(text=text, heading=name == "h", bullet=in_list and first))
                        first = False
            elif name == "list":
                walk(child, True)
            elif name is not None:
                walk(child, in_list)

    walk(document.text, False)
    return Extracted(lines, "odt")


_EXTRACTORS = {"pdf": _pdf, "docx": _docx, "txt": _txt, "md": _md, "rtf": _rtf, "odt": _odt}
