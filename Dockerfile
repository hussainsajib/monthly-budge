# Stage 1: build the React front end (served by FastAPI under /app).
FROM node:22-slim AS frontend
WORKDIR /build
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# Stage 2: the API / server.
FROM python:3.13-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /srv
COPY requirements.txt .
RUN pip install -r requirements.txt

COPY alembic.ini .
COPY migrations ./migrations
COPY app ./app
COPY --from=frontend /build/dist ./frontend/dist
COPY scripts/start.sh ./start.sh

RUN useradd --create-home appuser && mkdir -p /srv/data && chown -R appuser /srv
USER appuser

# Cloud Run injects PORT; default for local `docker run`.
ENV PORT=8080
EXPOSE 8080
CMD ["sh", "./start.sh"]
