# CI records immutable upstream digests in build-manifest.json.
ARG NODE_IMAGE=node:24-bookworm-slim
ARG PYTHON_IMAGE=python:3.12-slim-bookworm
ARG UV_IMAGE=ghcr.io/astral-sh/uv:0.13.4
FROM ${NODE_IMAGE} AS frontend
WORKDIR /web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
RUN npm run build
FROM ${UV_IMAGE} AS uv
FROM ${PYTHON_IMAGE} AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates libstdc++6 libgomp1 && rm -rf /var/lib/apt/lists/*
COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy PATH=/app/.venv/bin:$PATH
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev --no-install-project
COPY src/ ./src/
COPY contracts/ ./contracts/
COPY scripts/ ./scripts/
COPY supabase/ ./supabase/
RUN uv sync --frozen --no-dev
COPY --from=frontend /web/dist/ ./apps/web/dist/
RUN useradd --uid 10001 --create-home app && mkdir -p /var/backups/tisiif && chown -R app:app /app /var/backups/tisiif
USER app
EXPOSE 8000
CMD ["python","-m","lab.cli","web"]
