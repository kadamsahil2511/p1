"""Bounded discovery and extraction for owner-approved news sites."""

import ipaddress
import html as html_lib
import json
import os
import re
import socket
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from urllib.parse import urljoin, urlparse, urlunparse
from urllib.robotparser import RobotFileParser
from uuid import NAMESPACE_URL, uuid5

import requests
from bs4 import BeautifulSoup


USER_AGENT = "TechNewsBot/0.1 (+personal research)"
ROBOTS = {}


def validate_public_url(url: str) -> str:
    parsed = urlparse(url.strip())
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in (None, 443):
        raise ValueError("Source must be a public HTTPS URL without credentials or custom port.")
    try:
        addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)}
    except OSError as error:
        raise ValueError("Could not resolve source hostname.") from error
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("Source hostname resolves to a non-public address.")
    return urlunparse(parsed._replace(fragment=""))


def _get(url: str) -> tuple[str, bytes]:
    for _ in range(4):
        url = validate_public_url(url)
        parsed = urlparse(url)
        origin = f"{parsed.scheme}://{parsed.netloc}"
        if origin not in ROBOTS:
            response = requests.get(f"{origin}/robots.txt", timeout=10, allow_redirects=False, headers={"User-Agent": USER_AGENT})
            if response.status_code == 404:
                ROBOTS[origin] = None
            elif response.status_code == 200 and len(response.content) <= 500_000:
                parser = RobotFileParser()
                parser.parse(response.text.splitlines())
                ROBOTS[origin] = parser
            else:
                raise ValueError(f"Could not verify robots rules for {origin}.")
        if ROBOTS[origin] is not None and not ROBOTS[origin].can_fetch(USER_AGENT, url):
            raise ValueError(f"Robots rules disallow {url}.")
        with requests.get(url, timeout=15, allow_redirects=False, stream=True, headers={"User-Agent": USER_AGENT}) as response:
            if response.status_code in (301, 302, 303, 307, 308):
                url = urljoin(url, response.headers.get("Location", ""))
                continue
            response.raise_for_status()
            data = bytearray()
            for chunk in response.iter_content(65536):
                data.extend(chunk)
                if len(data) > 2_000_000:
                    raise ValueError("Page exceeds 2 MB limit.")
            return url, bytes(data)
    raise ValueError("Too many redirects.")


def _date(value: str) -> str:
    if not value:
        return ""
    try:
        return parsedate_to_datetime(value).date().isoformat()
    except (TypeError, ValueError):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00")).date().isoformat()
        except ValueError:
            return ""


def _text(html: str) -> str:
    return BeautifulSoup(html, "html.parser").get_text(" ", strip=True) if "<" in html else html_lib.unescape(html).strip()


def is_editorial(title: str) -> bool:
    return not re.search(r"(?i)\b(last chance|discount|membership|webinar|tickets|subscribe|register|giveaway|sale ends|join us)\b", title)


def parse_feed(data: bytes) -> list[dict]:
    try:
        root = ET.fromstring(data)
    except ET.ParseError:
        return []
    articles = []
    for item in root.iter():
        if item.tag.split("}")[-1] not in ("item", "entry"):
            continue
        values = {}
        for child in item:
            key = child.tag.split("}")[-1]
            if key in ("title", "link", "pubDate", "published", "updated", "description", "summary", "content", "encoded"):
                values[key] = child.attrib.get("href") or child.text or ""
        url = values.get("link", "")
        if not url.startswith("https://"):
            continue
        articles.append({
            "url": url,
            "title": _text(values.get("title", "")),
            "published": _date(values.get("pubDate") or values.get("published") or values.get("updated", "")),
            "text": _text(values.get("encoded") or values.get("content") or values.get("summary") or values.get("description", "")),
        })
    return articles


def extract_article(html: str, url: str) -> dict:
    soup = BeautifulSoup(html, "html.parser")
    canonical = soup.find("link", rel="canonical")
    link = urljoin(url, canonical.get("href", "")) if canonical else url
    if urlparse(link).hostname != urlparse(url).hostname:
        link = url
    title_node = soup.find("h1") or soup.find("title")
    date_node = soup.find("meta", property="article:published_time") or soup.find("meta", attrs={"name": "date"})
    date_text = date_node.get("content", "") if date_node else ""
    if not date_text:
        match = re.search(r'"datePublished"\s*:\s*"([^"]+)', html)
        date_text = match.group(1) if match else ""
    for node in soup.select("script, style, nav, header, footer, aside"):
        node.decompose()
    mains = soup.find_all("main")
    articles = soup.find_all("article")
    main = max(mains, key=lambda node: len(node.get_text(" ", strip=True))) if mains else None
    content = main.get_text(" ", strip=True) if main else " ".join(node.get_text(" ", strip=True) for node in articles) if articles else soup.body.get_text(" ", strip=True) if soup.body else ""
    return {
        "url": link,
        "title": title_node.get_text(" ", strip=True) if title_node else "",
        "published": _date(date_text),
        "text": content,
    }


def _links(html: str, page: str) -> list[str]:
    soup = BeautifulSoup(html, "html.parser")
    host = urlparse(page).hostname
    links = []
    for anchor in soup.find_all("a", href=True):
        url = urljoin(page, anchor["href"]).split("#", 1)[0]
        parsed = urlparse(url)
        segments = [segment for segment in parsed.path.split("/") if segment]
        if parsed.scheme == "https" and parsed.hostname == host and url != page and len(segments) >= 2 and not re.search(r"/(tag|category|articles-category|author|signup|subscribe|login|about)(/|$)", parsed.path):
            links.append(url)
    return list(dict.fromkeys(links))


def _feed_url(html: str, page: str) -> str | None:
    soup = BeautifulSoup(html, "html.parser")
    for link in soup.find_all("link", href=True):
        if link.get("type") in ("application/rss+xml", "application/atom+xml"):
            return urljoin(page, link["href"])
    return None


def probe(url: str) -> dict:
    url, data = _get(url)
    feed = parse_feed(data)
    if feed:
        method, feed_url, items = "feed", url, feed
    else:
        html = data.decode("utf-8", errors="replace")
        feed_url = _feed_url(html, url)
        feed = parse_feed(_get(feed_url)[1]) if feed_url else []
        method, items = ("feed", feed) if feed else ("archive", [{"url": link} for link in _links(html, url)[:12]])
    for item in items[:12]:
        try:
            if urlparse(item["url"]).hostname != urlparse(url).hostname:
                continue
            article = item if len(item.get("text", "")) >= 250 else extract_article(_get(item["url"])[1].decode("utf-8", errors="replace"), item["url"])
            if len(article["text"]) >= 250 and article["title"] and article["published"] and is_editorial(article["title"]):
                return {"name": urlparse(url).hostname, "url": url, "method": method, "feed_url": feed_url, "sample": {key: article[key] for key in ("title", "published", "url")}}
        except (requests.RequestException, ValueError):
            continue
    raise ValueError("No recent article with title, date, and readable text found.")


def collect(source: dict, limit: int = 8) -> list[dict]:
    page, data = _get(source["feed_url"] or source["url"])
    items = parse_feed(data) if source["method"] == "feed" else [{"url": link} for link in _links(data.decode("utf-8", errors="replace"), page)]
    articles = []
    for item in items[:limit]:
        try:
            if urlparse(item["url"]).hostname != urlparse(source["url"]).hostname:
                continue
            article = item if len(item.get("text", "")) >= 250 else extract_article(_get(item["url"])[1].decode("utf-8", errors="replace"), item["url"])
            if len(article["text"]) >= 250 and article["title"] and article["published"] and is_editorial(article["title"]) and urlparse(article["url"]).hostname == urlparse(source["url"]).hostname:
                articles.append({**article, "source_id": source["id"], "source": source["name"]})
        except (requests.RequestException, ValueError):
            continue
    return articles


class SourceRegistry:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.sources = json.loads(self.path.read_text()) if self.path.exists() else []

    def _save(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.sources, indent=2) + "\n")
        os.replace(temporary, self.path)

    def list(self) -> list[dict]:
        return list(self.sources)

    def add(self, source: dict) -> dict:
        source = {key: source.get(key) for key in ("name", "url", "method", "feed_url")}
        source["id"] = str(uuid5(NAMESPACE_URL, source["url"]))
        if any(item["id"] == source["id"] for item in self.sources):
            raise ValueError("Source is already added.")
        self.sources.append(source)
        self._save()
        return source

    def remove(self, source_id: str) -> dict:
        source = next((item for item in self.sources if item["id"] == source_id), None)
        if source is None:
            raise ValueError("Source not found.")
        self.sources.remove(source)
        self._save()
        return source
