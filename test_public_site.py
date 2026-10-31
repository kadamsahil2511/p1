from html.parser import HTMLParser
from pathlib import Path
import re
import unittest


ROOT = Path(__file__).parent
HTML_PATH = ROOT / "public" / "index.html"


class PageParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tags = []
        self.hrefs = []
        self.images = []
        self.text = []

    def handle_starttag(self, tag, attrs):
        attributes = dict(attrs)
        self.tags.append(tag)
        if href := attributes.get("href"):
            self.hrefs.append(href)
        if tag == "img":
            self.images.append(attributes)

    def handle_data(self, data):
        if data.strip():
            self.text.append(data.strip())


class PublicSiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.source = HTML_PATH.read_text(encoding="utf-8")
        cls.page = PageParser()
        cls.page.feed(cls.source)
        cls.visible_text = " ".join(cls.page.text).lower()

    def test_semantic_one_page_structure(self):
        for tag in ("header", "nav", "main", "footer"):
            self.assertIn(tag, self.page.tags)
        self.assertGreaterEqual(self.page.tags.count("section"), 5)
        self.assertEqual(self.page.tags.count("h1"), 1)

    def test_primary_links_are_present(self):
        self.assertIn(
            "https://wa.me/919136093485?text=%2Fhelp", self.page.hrefs
        )
        self.assertIn("https://github.com/kadamsahil2511/p1", self.page.hrefs)
        self.assertIn("https://console.groq.com/keys", self.page.hrefs)

    def test_real_whatsapp_proof_is_used_twice(self):
        proof_images = [
            image
            for image in self.page.images
            if image.get("src") == "assets/p1-whatsapp-proof.png"
        ]
        self.assertEqual(len(proof_images), 2)
        self.assertTrue(all(image.get("alt", "").strip() for image in proof_images))
        self.assertTrue((HTML_PATH.parent / "assets/p1-whatsapp-proof.png").is_file())

    def test_phone_screens_do_not_zoom_and_crop_image_sides(self):
        for crop in ("digest", "answer"):
            rule = re.search(
                rf"\.screen-crop--{crop} img\s*\{{([^}}]+)\}}",
                self.source,
                re.DOTALL,
            )
            self.assertIsNotNone(rule)
            self.assertNotRegex(rule.group(1), r"width:\s*(?:1[1-9]\d|[2-9]\d\d)%")

    def test_answer_crop_masks_owner_only_content(self):
        self.assertRegex(
            self.source,
            r"\.screen-crop--answer::after\s*\{[^}]*height:\s*30%[^}]*background:\s*#0b141a",
        )

    def test_answer_crop_starts_with_the_user_message(self):
        self.assertRegex(
            self.source,
            r"\.screen-crop--answer img\s*\{[^}]*transform:\s*translateY\(0\)",
        )

    def test_security_and_cost_copy_is_explicit(self):
        for phrase in (
            "bring your own groq key",
            "ten minutes",
            "encrypted",
            "provider charges",
            "when the evidence isn't there, p1 doesn't invent an answer",
        ):
            self.assertIn(phrase, self.visible_text)

    def test_architecture_keeps_retrieval_and_generation_separate(self):
        self.assertIn("<strong>Qdrant</strong>", self.source)
        self.assertIn("<strong>Groq</strong>", self.source)

    def test_motion_has_an_accessible_fallback(self):
        self.assertIn("prefers-reduced-motion: reduce", self.source)

    def test_phone_mockup_has_no_third_party_wordmark(self):
        self.assertNotIn("samsung", self.source.lower())


if __name__ == "__main__":
    unittest.main()
