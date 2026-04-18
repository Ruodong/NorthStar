"""Application configuration loaded from environment variables."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Postgres — holds both the relational layer (northstar.*) and the AGE
    # graph (ns_graph). The graph_client shares this DSN via its own asyncpg
    # pool so session-state (LOAD 'age') stays isolated from pg_client.
    postgres_dsn: str = "postgresql://northstar:northstar_dev@postgres:5432/northstar"

    # Confluence REST API
    confluence_base_url: str = ""
    confluence_token: str = ""
    confluence_space_key: str = "ARD"

    # LLM (Azure OpenAI-compatible)
    llm_base_url: str = ""
    llm_api_key: str = ""
    llm_model: str = "gpt-4o"
    llm_enabled: bool = False

    # Local fallback for ingestion (loads .drawio files from disk instead of Confluence)
    local_drawio_root: str = ""

    # CORS
    cors_origins: str = "*"

    # S3 attachment storage (see .specify/features/s3-attachments/spec.md).
    # When s3_enabled=False, backend serves attachments exclusively from local FS —
    # identical to pre-S3 behavior. When True, backend prefers S3 for attachments
    # whose confluence_attachment.s3_key column is populated, with automatic
    # fallback to local FS on any S3 error.
    s3_enabled: bool = False
    s3_endpoint: str = ""
    s3_region: str = "us-east-1"
    s3_access_key: str = ""
    s3_secret_key: str = ""
    s3_bucket: str = ""
    s3_prefix: str = "pm/northstar/attachments"

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")


settings = Settings()
