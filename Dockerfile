FROM oven/bun:1.4.4 AS frontend
WORKDIR /build
COPY erosia/web/package.json erosia/web/bun.lock ./
RUN bun install --frozen-lockfile
COPY erosia/web ./
RUN bun run build

FROM frontend AS backend
COPY erosia /backend/erosia
RUN rm -rf /backend/erosia/web

FROM python:3.15.1-slim-trixie
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt && useradd -u 1000 erosia && mkdir -p /data /media && chown erosia:erosia /data
COPY --from=backend --chown=1000:1000 /backend/erosia ./erosia
COPY --from=frontend --chown=1000:1000 /build/dist ./erosia/web/dist
RUN python -c "from erosia.images import validate_resources; validate_resources()"
USER erosia
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD ["python", "-c", "import urllib.request; urllib.request.urlopen('http://127.0.0.1:9307/api/health', timeout=5)"]
CMD ["python", "-m", "erosia"]
