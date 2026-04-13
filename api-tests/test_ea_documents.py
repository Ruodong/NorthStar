"""Integration tests for EA Knowledge Layer endpoints."""
import pytest


@pytest.mark.asyncio
async def test_ea_documents_list(api):
    """GET /api/ea-documents returns valid structure."""
    r = await api.get("/api/ea-documents")
    assert r.status_code == 200
    body = r.json()
    assert body["success"] is True
    data = body["data"]
    assert "documents" in data
    assert "total" in data
    assert "domains" in data
    assert isinstance(data["documents"], list)
    assert isinstance(data["total"], int)
    assert isinstance(data["domains"], list)


@pytest.mark.asyncio
async def test_ea_documents_filter_by_domain(api):
    """Filter by domain returns only matching docs (or empty)."""
    r = await api.get("/api/ea-documents", params={"domain": "ta"})
    assert r.status_code == 200
    data = r.json()["data"]
    for doc in data["documents"]:
        assert doc["domain"] == "ta"


@pytest.mark.asyncio
async def test_ea_documents_filter_by_type(api):
    """Filter by doc_type returns only matching docs (or empty)."""
    r = await api.get("/api/ea-documents", params={"doc_type": "standard"})
    assert r.status_code == 200
    data = r.json()["data"]
    for doc in data["documents"]:
        assert doc["doc_type"] == "standard"


@pytest.mark.asyncio
async def test_ea_documents_text_search(api):
    """Text search param works without errors."""
    r = await api.get("/api/ea-documents", params={"q": "API"})
    assert r.status_code == 200
    assert r.json()["success"] is True


@pytest.mark.asyncio
async def test_ea_documents_templates(api):
    """GET /api/ea-documents/templates returns template docs (or empty)."""
    r = await api.get("/api/ea-documents/templates")
    assert r.status_code == 200
    data = r.json()["data"]
    assert isinstance(data, list)
    for doc in data:
        assert doc["doc_type"] == "template"


@pytest.mark.asyncio
async def test_ea_documents_for_app(api):
    """Contextual EA docs for an app returns list (may be empty if no data synced)."""
    r = await api.get("/api/ea-documents/for-app/A003530")
    assert r.status_code == 200
    data = r.json()["data"]
    assert isinstance(data, list)


@pytest.mark.asyncio
async def test_ea_documents_for_nonexistent_app(api):
    """Contextual EA docs for unknown app returns empty list."""
    r = await api.get("/api/ea-documents/for-app/NONEXISTENT")
    assert r.status_code == 200
    data = r.json()["data"]
    assert data == []


@pytest.mark.asyncio
async def test_search_includes_ea_documents(api):
    """Verify unified search response includes ea_documents field."""
    r = await api.get("/api/search", params={"q": "standard"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "ea_documents" in data
    assert isinstance(data["ea_documents"], list)


@pytest.mark.asyncio
async def test_search_short_query_includes_ea_documents(api):
    """Short query returns empty ea_documents (not missing key)."""
    r = await api.get("/api/search", params={"q": "x"})
    assert r.status_code == 200
    data = r.json()["data"]
    assert "ea_documents" in data
    assert data["ea_documents"] == []
