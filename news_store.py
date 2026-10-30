"""Local Qdrant article index and persistent digest delivery history."""

import json
import os
import re
from datetime import date, timedelta
from difflib import SequenceMatcher
from pathlib import Path
from uuid import NAMESPACE_URL, uuid5

from qdrant_client import QdrantClient, models
from sklearn.feature_extraction.text import HashingVectorizer


COLLECTION = "p1"
# shortcut: lexical vectors miss paraphrases, upgrade to semantic or hybrid search when retrieval quality needs it.
VECTORIZER = HashingVectorizer(n_features=65536, alternate_sign=False, norm="l2", stop_words="english")


def sparse_vector(text: str) -> models.SparseVector:
    row = VECTORIZER.transform([text]).tocsr()
    return models.SparseVector(indices=row.indices.tolist(), values=row.data.tolist())


class NewsStore:
    def __init__(self, path: Path):
        self.client = QdrantClient(path=str(path))

    def upsert(self, articles: list[dict]) -> int:
        if not articles:
            return 0
        ids = [str(uuid5(NAMESPACE_URL, article["url"])) for article in articles]
        if self.client.collection_exists(COLLECTION):
            existing = {str(point.id) for point in self.client.retrieve(COLLECTION, ids, with_payload=False)}
        else:
            existing = set()
        fresh = [(article, point_id) for article, point_id in zip(articles, ids) if point_id not in existing]
        if not fresh:
            return 0
        vectors = [sparse_vector(article["title"] + " " + article["text"][:4000]) for article, _ in fresh]
        if not self.client.collection_exists(COLLECTION):
            self.client.create_collection(COLLECTION, vectors_config={}, sparse_vectors_config={"text": models.SparseVectorParams()})
        self.client.upsert(COLLECTION, [models.PointStruct(id=point_id, vector={"text": vector}, payload={**article, "text": article["text"][:12000]}) for (article, point_id), vector in zip(fresh, vectors)])
        return len(fresh)

    def latest(self, limit: int = 20) -> list[dict]:
        if not self.client.collection_exists(COLLECTION):
            return []
        points, _ = self.client.scroll(COLLECTION, limit=1000, with_payload=True)
        return sorted((point.payload for point in points), key=lambda item: item.get("published", ""), reverse=True)[:limit]

    def search(self, query: str, limit: int = 8) -> list[dict]:
        if not self.client.collection_exists(COLLECTION):
            return []
        vector = sparse_vector(query)
        if not vector.indices:
            return []
        return [point.payload for point in self.client.query_points(COLLECTION, query=vector, using="text", limit=limit, with_payload=True).points]

    def remove_source(self, source_id: str) -> None:
        if self.client.collection_exists(COLLECTION):
            self.client.delete(COLLECTION, models.FilterSelector(filter=models.Filter(must=[models.FieldCondition(key="source_id", match=models.MatchValue(value=source_id))])))


def _similar(a: dict, b: dict) -> bool:
    if a["url"] == b["url"]:
        return True
    left = re.findall(r"[a-z0-9]+", a["title"].lower())
    right = re.findall(r"[a-z0-9]+", b["title"].lower())
    if len(left) < 3 or len(right) < 3:
        return False
    return SequenceMatcher(None, left, right).ratio() >= 0.82 or len(set(left) & set(right)) / len(set(left) | set(right)) >= 0.72


def select_new_stories(articles: list[dict], ledger: "DeliveryLedger", today: str) -> list[dict]:
    cutoff = (date.fromisoformat(today) - timedelta(days=7)).isoformat()
    selected = []
    for article in articles:
        if not cutoff <= article.get("published", "") <= today:
            continue
        if any(_similar(article, prior) for prior in ledger.sent + selected):
            continue
        selected.append(article)
    return selected


class DeliveryLedger:
    def __init__(self, path: Path):
        self.path = Path(path)
        self.sent = json.loads(self.path.read_text()) if self.path.exists() else []

    def record(self, articles: list[dict], day: str) -> None:
        self.sent.extend({"url": article["url"], "title": article["title"], "day": day} for article in articles)
        self.path.parent.mkdir(parents=True, exist_ok=True)
        temporary = self.path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.sent, indent=2) + "\n")
        os.replace(temporary, self.path)
