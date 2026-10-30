"""Add verified public sources through the P1 API."""

import os

import requests
from dotenv import load_dotenv


SOURCES = [
    "https://newsletter.aicollective.com/",
    "https://newsletter.pragmaticengineer.com/",
    "https://blog.bytebytego.com/",
    "https://www.a16z.news/",
    "https://simonwillison.net/atom/entries/",
    "https://huggingface.co/blog/feed.xml",
    "https://github.blog/feed/",
    "https://signup.tldr.tech/tech/archives",
    "https://www.therundown.ai/articles",
]


def main() -> None:
    load_dotenv()
    base = os.getenv("P1_API_URL", "http://127.0.0.1:8765")
    token = os.environ["P1_API_TOKEN"]
    for url in SOURCES:
        response = requests.post(f"{base}/sources", json={"url": url}, headers={"Authorization": f"Bearer {token}"}, timeout=120)
        if response.status_code == 200:
            result = response.json()
            assert result["sample"]["url"] and result["sample"]["published"]
            print(f"Added {url}: {result['sample']['title']}")
        else:
            print(f"Skipped {url}: {response.json().get('detail', response.status_code)}")


if __name__ == "__main__":
    main()
