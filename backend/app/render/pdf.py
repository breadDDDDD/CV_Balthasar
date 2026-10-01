"""HTML -> PDF with WeasyPrint.

WeasyPrint needs native Pango libraries. They are in the Docker image; on a bare
Windows machine the import fails and PDF features report themselves unavailable.
"""

from __future__ import annotations

from functools import lru_cache


class PdfUnavailable(Exception):
    pass


@lru_cache(maxsize=1)
def _weasyprint():
    try:
        import weasyprint

        return weasyprint
    except Exception:  # OSError for missing shared libraries
        return None


def pdf_available() -> bool:
    return _weasyprint() is not None


def _no_fetch(url: str, *args, **kwargs):
    # The document is fully self-contained; never let it trigger a network or file read.
    raise ValueError(f"External resources are disabled: {url}")


def _document(html: str):
    weasyprint = _weasyprint()
    if weasyprint is None:
        raise PdfUnavailable("PDF rendering is not available on this machine. Run the backend with Docker.")
    return weasyprint.HTML(string=html, url_fetcher=_no_fetch).render()


def html_to_pdf(html: str) -> bytes:
    return _document(html).write_pdf()


def count_pages(html: str) -> int:
    return len(_document(html).pages)
