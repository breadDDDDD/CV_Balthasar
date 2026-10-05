"""HTML -> PDF with WeasyPrint.

WeasyPrint needs native Pango libraries. They are in the Docker image; on a bare
Windows machine the import fails and PDF features report themselves unavailable.
"""

from __future__ import annotations

import hashlib
import threading
from collections import OrderedDict
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


# Page counts by digest of the HTML, so undo, redo and repeated edits skip the layout.
# Memory only, and it holds digests and numbers, never CV text.
_PAGE_CACHE_SIZE = 512
_page_cache: OrderedDict[str, int] = OrderedDict()
_page_lock = threading.Lock()


def count_pages(html: str) -> int:
    key = hashlib.sha256(html.encode("utf-8")).hexdigest()
    with _page_lock:
        if key in _page_cache:
            _page_cache.move_to_end(key)
            return _page_cache[key]
    pages = len(_document(html).pages)
    with _page_lock:
        _page_cache[key] = pages
        if len(_page_cache) > _PAGE_CACHE_SIZE:
            _page_cache.popitem(last=False)
    return pages
