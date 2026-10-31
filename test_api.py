import sys
from pathlib import Path
from unittest.mock import patch

import requests
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).parent))

from api import create_app
from news_store import NewsStore
from sources import SourceRegistry


def test_api_requires_token_and_refreshes_added_source(tmp_path):
    registry = SourceRegistry(tmp_path / "sources.json")
    store = NewsStore(tmp_path / "qdrant")
    client = TestClient(create_app(registry, store, "secret"))
    assert client.get("/sources").status_code == 401
    headers = {"Authorization": "Bearer secret"}
    source = {"name": "Example", "url": "https://example.com/feed", "feed_url": "https://example.com/feed", "method": "feed", "sample": {"title": "New model", "published": "2026-10-29", "url": "https://example.com/post"}}
    article = {"url": "https://example.com/post", "title": "New model", "published": "2026-10-29", "text": "Useful technology news " * 20, "source_id": "ignored", "source": "Example"}
    with patch("api.probe", return_value=source), patch("api.collect", return_value=[article]):
        added = client.post("/sources", json={"url": source["url"]}, headers=headers)
        assert added.status_code == 200
        assert client.post("/refresh", headers=headers).json()["added"] == 1
        assert client.post("/refresh", headers=headers).json()["added"] == 0
        assert len(client.get("/articles/latest", headers=headers).json()) == 1
        assert client.delete(f"/sources/{added.json()['id']}", headers=headers).status_code == 200
        assert client.get("/articles/latest", headers=headers).json() == []


def test_refresh_reports_one_source_failure_and_continues(tmp_path):
    registry = SourceRegistry(tmp_path / "sources.json")
    failed = registry.add({"name": "Failed", "url": "https://failed.example/feed", "feed_url": "https://failed.example/feed", "method": "feed"})
    registry.add({"name": "Working", "url": "https://working.example/feed", "feed_url": "https://working.example/feed", "method": "feed"})
    store = NewsStore(tmp_path / "qdrant")
    client = TestClient(create_app(registry, store, "secret"))
    article = {"url": "https://working.example/post", "title": "New model", "published": "2026-10-29", "text": "Useful technology news " * 20}

    def collect(source):
        if source["id"] == failed["id"]:
            raise requests.ConnectionError("source timed out")
        return [article]

    with patch("api.collect", side_effect=collect):
        result = client.post("/refresh", headers={"Authorization": "Bearer secret"}).json()
    assert result["added"] == 1
    assert "source timed out" in result["errors"][failed["id"]]


def test_default_sources_seeded_once(tmp_path):
    from api import source_registry_path
    path = source_registry_path(tmp_path / "fresh")
    assert len(__import__("json").loads(path.read_text())) == 9
    path.write_text("[]")
    assert source_registry_path(tmp_path / "fresh").read_text() == "[]"


def test_firecrawl_scrape_requires_auth_and_returns_page_evidence(tmp_path, monkeypatch):
    registry = SourceRegistry(tmp_path / "sources.json")
    store = NewsStore(tmp_path / "qdrant")
    client = TestClient(create_app(registry, store, "secret"))
    url = "https://example.com/story"
    assert client.post("/web/scrape", json={"url": url}).status_code == 401
    headers = {"Authorization": "Bearer secret"}
    assert client.post("/web/scrape", json={"url": "https://127.0.0.1/private"}, headers=headers).status_code == 400
    monkeypatch.setenv("FIRECRAWL_API_KEY", "test-key")
    reply = requests.Response()
    reply.status_code = 200
    reply._content = b'{"success":true,"data":{"markdown":"Page facts and details.","metadata":{"title":"A story"}}}'
    with patch("api.validate_public_url", return_value=url), patch("api.requests.post", return_value=reply) as post:
        result = client.post("/web/scrape", json={"url": url}, headers=headers)
    assert result.status_code == 200
    assert result.json() == {"url": url, "title": "A story", "source": "example.com", "published": "", "text": "Page facts and details."}
    assert post.call_args.args[0] == "https://api.firecrawl.dev/v2/scrape"
    assert post.call_args.kwargs["json"]["url"] == url


def test_github_scrape_uses_readme_and_caps_context(tmp_path, monkeypatch):
    client = TestClient(create_app(SourceRegistry(tmp_path / "sources.json"), NewsStore(tmp_path / "qdrant"), "secret"))
    monkeypatch.setenv("FIRECRAWL_API_KEY", "test-key")
    url = "https://github.com/kadamsahil2511/p1"
    navigation = "GitHub navigation " * 1100
    readme = "# P1 Assistant\nMastra, Groq, MCP, and Qdrant. " + "Detail " * 2000
    reply = requests.Response()
    reply.status_code = 200
    reply._content = __import__("json").dumps({"success": True, "data": {"markdown": navigation + "\n## Repository files navigation\n" + readme}}).encode()
    with patch("api.validate_public_url", return_value=url), patch("api.requests.post", return_value=reply):
        result = client.post("/web/scrape", json={"url": url}, headers={"Authorization": "Bearer secret"})
    assert result.status_code == 200
    assert result.json()["text"].startswith("# P1 Assistant")
    assert len(result.json()["text"]) <= 8000
