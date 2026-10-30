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
