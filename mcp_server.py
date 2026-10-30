"""MCP tools that talk only to the private P1 API."""

import json
import os

import requests
from mcp.server.mcpserver import MCPServer


mcp = MCPServer("p1-api")


def request_api(method: str, path: str, payload: dict | None = None):
    try:
        response = requests.request(
            method,
            os.getenv("P1_API_URL", "http://127.0.0.1:8765") + path,
            headers={"Authorization": f"Bearer {os.getenv('P1_API_TOKEN', '')}"},
            json=payload if method == "POST" else None,
            params=payload if method == "GET" else None,
            timeout=120 if path == "/refresh" else 30,
        )
    except requests.RequestException as error:
        raise RuntimeError(f"P1 API unavailable: {error}") from error
    try:
        body = response.json()
    except ValueError as error:
        raise RuntimeError(f"P1 API returned HTTP {response.status_code} without JSON.") from error
    if response.status_code >= 400:
        raise RuntimeError(body.get("detail", f"API returned HTTP {response.status_code}"))
    return body


@mcp.tool()
def probe_source(url: str) -> str:
    """Check whether a public news website can be extracted and show a sample."""
    return json.dumps(request_api("POST", "/sources/probe", {"url": url}))


@mcp.tool()
def add_source(url: str) -> str:
    """Add a public news website after its extraction probe succeeds."""
    return json.dumps(request_api("POST", "/sources", {"url": url}))


@mcp.tool()
def list_sources() -> str:
    """List approved tech news websites."""
    return json.dumps(request_api("GET", "/sources"))


@mcp.tool()
def remove_source(source_id: str) -> str:
    """Remove a source and its indexed articles."""
    return json.dumps(request_api("DELETE", f"/sources/{source_id}"))


@mcp.tool()
def refresh_news() -> str:
    """Fetch new articles from approved sites and index them in Qdrant."""
    return json.dumps(request_api("POST", "/refresh"))


@mcp.tool()
def latest_news(limit: int = 20) -> str:
    """Get the latest indexed tech news articles."""
    return json.dumps(request_api("GET", "/articles/latest", {"limit": limit}))


@mcp.tool()
def search_news(query: str, limit: int = 8) -> str:
    """Search indexed tech news articles by meaning."""
    return json.dumps(request_api("GET", "/articles/search", {"query": query, "limit": limit}))


if __name__ == "__main__":
    mcp.run()
