"""Private P1 API: source management, ingestion, and retrieval."""

import os
import secrets
import shutil
import threading
import requests
from pathlib import Path
from time import monotonic
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException
from pydantic import BaseModel

from news_store import NewsStore
from logging_utils import get_logger
from sources import SourceRegistry, collect, probe, validate_public_url


DATA_DIR = Path(os.getenv("P1_DATA_DIR", Path(__file__).with_name("data")))
LOGGER = get_logger("api")


class SourceRequest(BaseModel):
    url: str


def create_app(registry: SourceRegistry, store: NewsStore, token: str) -> FastAPI:
    app = FastAPI(title="P1 API")
    refresh_lock = threading.Lock()

    def authorized(authorization: str = Header(default="")) -> None:
        if not token or not secrets.compare_digest(authorization, f"Bearer {token}"):
            raise HTTPException(401, "Invalid API token.")

    @app.get("/health")
    def health() -> dict:
        return {"ok": True}

    @app.post("/web/scrape", dependencies=[Depends(authorized)])
    def scrape_web_page(request: SourceRequest) -> dict:
        try:
            url = validate_public_url(request.url)
        except ValueError as error:
            raise HTTPException(400, str(error)) from error
        key = os.getenv("FIRECRAWL_API_KEY", "").strip()
        if not key:
            raise HTTPException(503, "Firecrawl is not configured.")
        try:
            response = requests.post(
                "https://api.firecrawl.dev/v2/scrape",
                headers={"Authorization": f"Bearer {key}"},
                json={"url": url, "formats": ["markdown"], "onlyMainContent": True},
                timeout=45,
            )
            response.raise_for_status()
            result = response.json()
        except (requests.RequestException, ValueError) as error:
            LOGGER.warning("web.scrape_failed host=%s error=%s", urlparse(url).hostname, type(error).__name__)
            raise HTTPException(502, "Firecrawl could not read this page.") from error
        data = result.get("data") if isinstance(result, dict) else None
        text = data.get("markdown") if isinstance(data, dict) else None
        if not isinstance(result, dict) or result.get("success") is not True or not isinstance(text, str) or not text.strip():
            raise HTTPException(502, "Firecrawl returned no readable page content.")
        metadata = data.get("metadata") if isinstance(data.get("metadata"), dict) else {}
        if urlparse(url).hostname == "github.com" and len(urlparse(url).path.strip("/").split("/")) == 2 and "## Repository files navigation" in text:
            text = text.split("## Repository files navigation", 1)[1].strip()
        LOGGER.info("web.scraped host=%s chars=%d", urlparse(url).hostname, len(text))
        return {"url": url, "title": str(metadata.get("title") or urlparse(url).hostname)[:200],
                "source": urlparse(url).hostname, "published": "", "text": text[:8000]}

    @app.get("/sources", dependencies=[Depends(authorized)])
    def sources() -> list[dict]:
        items = registry.list()
        LOGGER.info("sources.list count=%d", len(items))
        return items

    @app.post("/sources/probe", dependencies=[Depends(authorized)])
    def probe_source(request: SourceRequest) -> dict:
        LOGGER.info("source.probe host=%s", urlparse(request.url).hostname)
        try:
            result = probe(request.url)
            LOGGER.info("source.probed method=%s host=%s", result["method"], urlparse(result["url"]).hostname)
            return result
        except (ValueError, OSError) as error:
            LOGGER.warning("source.probe_failed error=%s", type(error).__name__)
            raise HTTPException(400, str(error)) from error

    @app.post("/sources", dependencies=[Depends(authorized)])
    def add_source(request: SourceRequest) -> dict:
        LOGGER.info("source.add host=%s", urlparse(request.url).hostname)
        try:
            result = probe(request.url)
            saved = registry.add(result)
            LOGGER.info("source.added id=%s method=%s", saved["id"], saved["method"])
            return {**saved, "sample": result["sample"]}
        except (ValueError, OSError) as error:
            LOGGER.warning("source.add_failed error=%s", type(error).__name__)
            raise HTTPException(400, str(error)) from error

    @app.delete("/sources/{source_id}", dependencies=[Depends(authorized)])
    def remove_source(source_id: str) -> dict:
        if not any(item["id"] == source_id for item in registry.list()):
            raise HTTPException(404, "Source not found.")
        store.remove_source(source_id)
        removed = registry.remove(source_id)
        LOGGER.info("source.removed id=%s", source_id)
        return removed

    @app.post("/refresh", dependencies=[Depends(authorized)])
    def refresh() -> dict:
        if not refresh_lock.acquire(blocking=False):
            raise HTTPException(409, "Refresh already running.")
        try:
            started = monotonic()
            LOGGER.info("refresh.start sources=%d", len(registry.list()))
            added, errors = 0, {}
            for source in registry.list():
                source_started = monotonic()
                LOGGER.info("refresh.source_start host=%s method=%s", urlparse(source["url"]).hostname, source["method"])
                try:
                    articles = [{**article, "source_id": source["id"], "source": source["name"]} for article in collect(source)]
                    new = store.upsert(articles)
                    added += new
                    LOGGER.info("refresh.source_done host=%s fetched=%d indexed=%d elapsed=%.1fs", urlparse(source["url"]).hostname, len(articles), new, monotonic() - source_started)
                except (ValueError, OSError, RuntimeError) as error:
                    errors[source["id"]] = str(error)
                    LOGGER.warning("refresh.source_failed host=%s error=%s elapsed=%.1fs", urlparse(source["url"]).hostname, type(error).__name__, monotonic() - source_started)
            LOGGER.info("refresh.done indexed=%d errors=%d elapsed=%.1fs", added, len(errors), monotonic() - started)
            return {"added": added, "errors": errors}
        finally:
            refresh_lock.release()

    @app.get("/articles/latest", dependencies=[Depends(authorized)])
    def latest(limit: int = 20) -> list[dict]:
        articles = store.latest(max(1, min(limit, 100)))
        LOGGER.info("articles.latest count=%d", len(articles))
        return articles

    @app.get("/articles/search", dependencies=[Depends(authorized)])
    def search(query: str, limit: int = 8) -> list[dict]:
        if not query.strip():
            raise HTTPException(400, "Search query is empty.")
        articles = store.search(query, max(1, min(limit, 20)))
        LOGGER.info("articles.search results=%d", len(articles))
        return articles

    return app


def source_registry_path(data_dir: Path) -> Path:
    path = data_dir / "sources.json"
    if not path.exists():
        data_dir.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(Path(__file__).with_name("default_sources.json"), path)
    return path


app = create_app(SourceRegistry(source_registry_path(DATA_DIR)), NewsStore(DATA_DIR / "qdrant"), os.getenv("P1_API_TOKEN", ""))
