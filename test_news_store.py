import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from news_store import DeliveryLedger, NewsStore, select_new_stories, sparse_vector


def test_sparse_vectors_match_shared_terms_without_model_download():
    first = sparse_vector("GitHub releases new code search")
    second = sparse_vector("New GitHub code search")
    assert first.indices and second.indices
    assert set(first.indices) & set(second.indices)


def test_upsert_same_article_does_not_duplicate_and_removal_clears_it(tmp_path):
    store = NewsStore(tmp_path / "qdrant")
    article = {"url": "https://example.com/one", "title": "New AI model released", "published": "2026-10-29", "text": "Useful details " * 30, "source_id": "source-1", "source": "Example"}
    assert store.upsert([article]) == 1
    assert store.upsert([article]) == 0
    assert len(store.latest()) == 1
    assert store.search("AI model")[0]["url"] == article["url"]
    store.remove_source("source-1")
    assert store.latest() == []


def test_delivery_ledger_skips_same_story_next_day_and_across_sources(tmp_path):
    ledger = DeliveryLedger(tmp_path / "delivered.json")
    first = {"url": "https://a.example/one", "title": "New AI model released today", "published": "2026-10-29"}
    duplicate = {"url": "https://b.example/two", "title": "New AI model released today", "published": "2026-10-30"}
    fresh = {"url": "https://c.example/three", "title": "GitHub adds new code search", "published": "2026-10-30"}
    assert select_new_stories([first, duplicate, fresh], ledger, "2026-10-30") == [first, fresh]
    ledger.record([first, fresh], "2026-10-30")
    assert select_new_stories([duplicate, fresh], DeliveryLedger(tmp_path / "delivered.json"), "2026-10-31") == []


def test_delivery_is_not_recorded_until_sent(tmp_path):
    ledger = DeliveryLedger(tmp_path / "delivered.json")
    article = {"url": "https://a.example/one", "title": "New model", "published": "2026-10-29"}
    assert select_new_stories([article], ledger, "2026-10-30") == [article]
    assert select_new_stories([article], DeliveryLedger(tmp_path / "delivered.json"), "2026-10-30") == [article]
