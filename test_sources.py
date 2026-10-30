import sys
from pathlib import Path
from unittest.mock import patch

import pytest

sys.path.insert(0, str(Path(__file__).parent))

from sources import SourceRegistry, _links, extract_article, is_editorial, parse_feed, validate_public_url


def test_rejects_local_and_non_https_urls():
    for url in ("http://example.com", "https://127.0.0.1/news", "https://localhost/news", "https://user:pass@example.com/"):
        with pytest.raises(ValueError):
            validate_public_url(url)


def test_accepts_public_https_url():
    with patch("sources.socket.getaddrinfo", return_value=[(None, None, None, None, ("93.184.216.34", 443))]):
        assert validate_public_url("https://example.com/news#top") == "https://example.com/news"


def test_parses_rss_article_and_date():
    xml = b"<rss><channel><item><title>New model</title><link>https://example.com/post</link><pubDate>Thu, 29 Oct 2026 13:37:07 GMT</pubDate><description>Useful details here.</description></item></channel></rss>"
    articles = parse_feed(xml)
    assert articles[0]["url"] == "https://example.com/post"
    assert articles[0]["title"] == "New model"
    assert articles[0]["published"] == "2026-10-29"
    assert "Useful details" in articles[0]["text"]


def test_extracts_main_content_and_canonical_url():
    html = '<html><head><title>Site</title><link rel="canonical" href="https://example.com/post"><meta property="article:published_time" content="2026-10-29T12:00:00Z"></head><body><nav>menu</nav><article><h1>New model</h1><p>Actual story with several useful details.</p></article></body></html>'
    article = extract_article(html, "https://example.com/post?utm_source=mail")
    assert article["title"] == "New model"
    assert article["published"] == "2026-10-29"
    assert article["url"] == "https://example.com/post"
    assert "menu" not in article["text"]


def test_extracts_json_date_and_multiple_issue_sections():
    html = '<html><head><script type="application/ld+json">{"datePublished":"2026-10-29"}</script><link rel="canonical" href="https://other.example/post"></head><body><h1>Daily issue</h1><article>First technology story with enough useful text.</article><article>Second technology story with more useful text.</article></body></html>'
    article = extract_article(html, "https://example.com/issue")
    assert article["published"] == "2026-10-29"
    assert article["url"] == "https://example.com/issue"
    assert "First technology" in article["text"] and "Second technology" in article["text"]


def test_registry_persists_and_removes_sources(tmp_path):
    registry = SourceRegistry(tmp_path / "sources.json")
    source = registry.add({"name": "Example", "url": "https://example.com/feed", "method": "feed", "feed_url": "https://example.com/feed"})
    assert SourceRegistry(tmp_path / "sources.json").list()[0]["id"] == source["id"]
    assert registry.remove(source["id"])["id"] == source["id"]
    assert registry.list() == []


def test_archive_links_prefer_articles_over_navigation():
    html = '<a href="/">Home</a><a href="/articles">Articles</a><a href="/articles-category/ai">AI</a><a href="/articles/new-model">New model</a>'
    assert _links(html, "https://example.com/articles") == ["https://example.com/articles/new-model"]


def test_promotion_titles_are_not_editorial_news():
    assert not is_editorial("Last chance to get every live course membership")
    assert is_editorial("How Uber Built A Gateway For AI Agents")
