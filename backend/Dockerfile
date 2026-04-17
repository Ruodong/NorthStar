FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
# Ship SQL migrations so ensure_sql_migrations() in app.main can apply
# them at container startup. Without this COPY the directory is missing
# and every migration after the initial postgres-entrypoint seed is
# silently skipped (applications_history / ingestion_diffs never get
# created, etc.). Migrations are required to be idempotent and additive
# — see CLAUDE.md § Schema Evolution Rules.
COPY sql ./sql

EXPOSE 8001
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8001"]
