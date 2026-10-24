# CI records immutable upstream digests in build-manifest.json.
ARG NODE_IMAGE=node@sha256:55fb5f5a527ea2c5c4a95f963e48ef90aa38c7b346054fdc8ee9957a2b55d205
ARG PYTHON_IMAGE=python@sha256:6a0e06f5ba0b373d051aabd3fffb9b873f27f9a2a3a14bcbe37dee6f0e3bbc70
ARG UV_IMAGE=ghcr.io/astral-sh/uv@sha256:9f130421e930bfbdc563c00740466603f8723158e90297d07957c2294640262b
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
