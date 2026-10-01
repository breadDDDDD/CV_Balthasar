FROM python:3.12-slim

# Pango is WeasyPrint's text engine. The fonts are metric-compatible stand-ins for
# Arial, Times New Roman, Calibri and Cambria so PDFs break lines like the preview.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz-subset0 \
        fonts-liberation fonts-crosextra-carlito fonts-crosextra-caladea \
    && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.9 /uv /bin/uv

WORKDIR /app
ENV UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PATH="/app/.venv/bin:$PATH"

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app ./app

USER nobody
# Cloud Run injects PORT. One worker keeps memory low on the smallest instance.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8080}"]
