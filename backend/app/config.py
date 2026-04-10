"""Application configuration loaded from environment variables."""
from __future__ import annotations

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    # Neo4j
    neo4j_uri: str = "bolt://neo4j:7687"
    neo4j_user: str = "neo4j"
    neo4j_password: str = "northstar_dev"

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

    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False, extra="ignore")


settings = Settings()
