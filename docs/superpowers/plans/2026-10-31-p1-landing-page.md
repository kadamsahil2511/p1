# P1 Landing Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace P1's functional onboarding guide with a polished Groq × Singularity-inspired product landing page using the supplied real WhatsApp screenshot inside a Galaxy-style 3D phone mockup.

**Architecture:** Keep the existing static Caddy deployment. A single semantic `public/index.html` owns content, responsive styles, the CSS phone, and progressive motion; one local PNG is reused with two different crops for the digest and grounded-abstention views. A small Python test protects required links, landmarks, asset references, privacy copy, and reduced-motion support.

**Tech Stack:** Static HTML5, CSS, minimal vanilla JavaScript, Caddy, Python stdlib tests, getdesign.md `Merlin` DESIGN.md reference

**Spec:** `docs/superpowers/specs/2026-10-31-p1-landing-page-design.md`

## Global Constraints

- Keep `public/` buildless and preserve the existing Caddy handling of `/setup` and `/setup/*`.
- Do not add React, Tailwind, runtime packages, analytics, authentication, or backend changes.
- Use only factual P1 capabilities; add no users, testimonials, customers, performance metrics, or endorsements.
- Use the supplied screenshot only after excluding personal data, live setup tokens, `/refresh`, and the mistyped query from public crops.
- The Galaxy-style phone uses CSS only and contains no Samsung wordmark or external mockup asset.
- The page works without JavaScript and honors `prefers-reduced-motion: reduce`.
- Primary CTA: `https://wa.me/919136093485?text=%2Fhelp`; secondary CTA: `https://github.com/kadamsahil2511/p1`.

## Review Focus

- The 1080×4283 source image must remain readable in both crops at 320px-wide mobile viewports.
- Long commands and source URLs must wrap without horizontal page overflow.
- With JavaScript unavailable, all content and navigation must remain visible and usable.
- With reduced motion enabled, phone float, signal drift, and reveal transitions must stop.
- Keyboard users must receive visible focus and 44px-minimum interactive targets.

---

### Task 1: Install the design reference and prepare the screenshot asset

**Files:**
- Create: `DESIGN.md`
- Create: `public/assets/p1-whatsapp-proof.png`

**Interfaces:**
- Consumes: getdesign.md template slug `merlin`; supplied screenshot `/Users/sahilshahajikadam/Downloads/Screenshot_20261031-070919.png`
- Produces: design tokens and component guidance in `DESIGN.md`; one deployable 1080×4283 PNG used by Task 2

- [ ] **Step 1: Install the getdesign.md reference**

Run: `npx getdesign add merlin --out DESIGN.md`

Expected: `DESIGN.md` exists at the P1 project root and documents the Merlin AI-assistant design language without changing `package.json`.

- [ ] **Step 2: Add the supplied screenshot without modifying the original**

Copy `/Users/sahilshahajikadam/Downloads/Screenshot_20261031-070919.png` to `public/assets/p1-whatsapp-proof.png`.

- [ ] **Step 3: Verify the asset**

Run: `sips -g pixelWidth -g pixelHeight -g format public/assets/p1-whatsapp-proof.png`

Expected: PNG, 1080×4283.

- [ ] **Step 4: Commit the design input and asset**

```bash
git add DESIGN.md public/assets/p1-whatsapp-proof.png
git commit -m "design: add P1 landing page direction"
```

### Task 2: Protect the landing-page contract with a focused test

**Files:**
- Create: `test_public_site.py`

**Interfaces:**
- Consumes: `public/index.html` and `public/assets/p1-whatsapp-proof.png`
- Produces: `PublicSiteTests`, a zero-dependency contract for required sections, links, screenshot accessibility, privacy language, and motion fallback

- [ ] **Step 1: Write the failing tests**

Add `PublicSiteTests` using `unittest`, `html.parser.HTMLParser`, and `pathlib.Path` with these assertions:

- The page contains `header`, `nav`, `main`, at least five `section` elements, one `h1`, and `footer`.
- The exact WhatsApp and GitHub URLs exist in anchor `href` values.
- Two images reference `assets/p1-whatsapp-proof.png`, each has non-empty `alt`, and the asset exists.
- Visible copy includes `bring your own Groq key`, `ten minutes`, `encrypted`, and `provider charges`.
- The source contains `prefers-reduced-motion: reduce` and no `Samsung` wordmark.

- [ ] **Step 2: Run the test to verify it fails against the old guide**

Run: `python3 -m unittest -v test_public_site.py`

Expected: FAIL because the current page has no screenshot images, five-section narrative, or reduced-motion rule.

- [ ] **Step 3: Commit the failing contract**

```bash
git add test_public_site.py
git commit -m "test: define P1 landing page contract"
```

### Task 3: Build the static product landing page

**Files:**
- Modify: `public/index.html`
- Test: `test_public_site.py`

**Interfaces:**
- Consumes: `DESIGN.md`, `public/assets/p1-whatsapp-proof.png`, existing product URLs and onboarding copy
- Produces: one responsive, self-contained landing page served by the existing Caddy configuration

- [ ] **Step 1: Replace the document metadata and navigation**

Set the title and description for a WhatsApp technology-news assistant. Add the compact P1 wordmark, anchors for `Product`, `How it works`, `Security`, and `Commands`, the GitHub link, and the orange WhatsApp CTA.

- [ ] **Step 2: Implement the light editorial hero**

Use the exact headline `Your technology briefing, already in WhatsApp.` Add factual supporting copy, WhatsApp and GitHub CTAs, and proof labels for `Self-hosted`, `Open source`, `Source-linked`, and `BYOK`.

- [ ] **Step 3: Implement the Galaxy-style phone component**

Create semantic device markup with screen glass, centered hole-punch camera, metallic rail, side buttons, glare, layered shadow, and perspective. Place the supplied screenshot in the screen and crop to the digest region without exposing `/refresh`.

- [ ] **Step 4: Implement the dark reliability demonstration**

Reuse the same image in a second crop that shows P1's grounded refusal and source URLs while excluding the mistyped question. Pair it with the line `When the evidence isn't there, P1 doesn't invent an answer.`

- [ ] **Step 5: Implement the architecture signal path**

Render `WhatsApp → Evolution API → Mastra → MCP / FastAPI → Qdrant → Groq` as a horizontal sequence that becomes vertical below 720px, with one factual sentence per stage.

- [ ] **Step 6: Implement security and four-step onboarding**

Explain the ten-minute setup link, encrypted key storage, WhatsApp confirmation, optional backup key, account deletion, and provider charges. Preserve links to Groq Console and the existing `/help`, `/register`, and `/confirm <code>` commands.

- [ ] **Step 7: Implement the command deck and final CTA**

Preserve all current commands and their meanings. Add the final WhatsApp CTA, GitHub source link, factual stack line, and footer disclaimer.

- [ ] **Step 8: Add progressive motion and accessibility behavior**

Use IntersectionObserver only to add a `data-visible` state; content remains visible by default. Add visible focus styles, 44px targets, descriptive image alt text, URL wrapping, responsive phone scaling, and a `prefers-reduced-motion: reduce` block that disables transitions and animation.

- [ ] **Step 9: Run the focused test**

Run: `python3 -m unittest -v test_public_site.py`

Expected: PASS with all landing-page contract tests green.

- [ ] **Step 10: Run the existing application checks**

Run: `npm run check && npm test`

Expected: TypeScript exits 0 and all existing Node tests pass.

- [ ] **Step 11: Commit the landing page**

```bash
git add public/index.html test_public_site.py
git commit -m "feat: launch P1 product landing page"
```

### Task 4: Verify the visitor experience in Chrome

**Files:**
- Verify: `public/index.html`
- Verify: `public/assets/p1-whatsapp-proof.png`
- Verify unchanged: `Caddyfile`

**Interfaces:**
- Consumes: completed static page from Task 3
- Produces: visual evidence that the desktop and mobile experiences meet the approved design

- [ ] **Step 1: Start a local static preview**

Run: `python3 -m http.server 4173 --directory public`

Expected: `http://127.0.0.1:4173/` serves the P1 landing page.

- [ ] **Step 2: Verify desktop layout in Chrome**

At 1440×900, confirm the hero hierarchy, digest crop, dark transition, architecture path, onboarding, command deck, final CTA, keyboard focus, and absence of horizontal overflow.

- [ ] **Step 3: Verify mobile layout in Chrome**

At 390×844, confirm readable screenshot crops, centered phone, vertical architecture sequence, 44px controls, wrapped URLs, and no clipping or horizontal overflow.

- [ ] **Step 4: Verify links and progressive behavior**

Confirm the WhatsApp, GitHub, Groq Console, and in-page navigation targets. Confirm the page remains readable when JavaScript is disabled and the reduced-motion CSS is present.

- [ ] **Step 5: Run the full focused verification again**

Run: `python3 -m unittest -v test_public_site.py && npm run check && npm test && git diff --check`

Expected: all commands exit 0, no test failures, and no whitespace errors.

- [ ] **Step 6: Stop the preview and record final repository status**

Run: `git status --short --branch`

Expected: clean `main` branch containing the three implementation commits; Caddy routing remains unchanged.

