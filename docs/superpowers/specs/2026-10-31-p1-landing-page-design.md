# P1 Landing Page Design

## Intent

Replace P1's functional onboarding guide with a polished product landing page that feels credible beside modern AI startups while remaining useful to people who want to start using the WhatsApp assistant. The page should make the product tangible through real WhatsApp screenshots, explain the production system without reading like documentation, and direct visitors to open P1 in WhatsApp.

## Goals

- Make P1 feel like a shipped product rather than a developer README rendered as a webpage.
- Lead with a real WhatsApp interaction inside a dimensional Android phone mockup.
- Preserve the existing onboarding instructions, command reference, GitHub link, privacy explanation, and WhatsApp CTA.
- Show enough architecture and operational detail to establish engineering credibility for technical visitors and recruiters.
- Keep the existing static Caddy deployment, `/setup/*` routing, and current backend untouched.
- Provide a responsive, accessible experience with restrained motion and a reduced-motion fallback.

## Non-goals

- No React, Tailwind, new application runtime, authentication flow, analytics, CMS, or backend changes.
- No fake usage counts, testimonials, customers, benchmarks, or performance claims.
- No imitation of Groq's or Singularity Hack's logos, proprietary art, or distinctive branded assets.
- No public exposure of API keys, setup tokens, private phone numbers, server addresses, or account data.

## Constraints

- The current site is `public/index.html`, served directly by Caddy at `p1.kadamsahil.com`.
- Caddy must continue to proxy `/setup` and `/setup/*` to the P1 application.
- The page must work without JavaScript; JavaScript may enhance motion only.
- The primary CTA remains the existing `wa.me` link and the secondary CTA remains the public GitHub repository.
- Supplied screenshots will be local assets committed under `public/assets/`; no third-party image host will be required.
- The phone must be Samsung/Galaxy-inspired without using a Samsung logo or suggesting endorsement.

## Approaches Considered

### 1. Groq-first editorial

Warm off-white surfaces, oversized typography, orange signal graphics, and very little motion. This is the fastest, clearest, and most accessible approach, but it undersells the conversational product experience.

### 2. Singularity-first cinematic

Near-black surfaces, particle motion, glowing accents, and a framed hero. This is memorable but makes onboarding content harder to scan and risks feeling like an event site instead of a dependable assistant.

### 3. Signal Grid hybrid — selected

Use Groq-inspired editorial clarity for the hero and narrative, then transition into a dark, immersive product-demo band inspired by Singularity Hack. The hybrid gives P1 startup-level presence while keeping the real product, instructions, and security model readable.

The implementation will install the `getdesign.md` Merlin AI-assistant reference with `npx getdesign add merlin --out DESIGN.md`, read that file, and adapt its reusable tokens rather than copying another company's page.

## Visual Direction

- **Light surface:** warm signal paper (`#F2F1E9`) rather than pure white.
- **Dark surface:** near-black (`#0C0E0D`) for the product-demo and architecture sections.
- **Primary accent:** high-energy signal orange (`#FF4B1F`) for CTAs, glyphs, progress lines, and focus states.
- **Product accent:** WhatsApp green used sparingly inside the phone UI and WhatsApp CTA.
- **Typography:** a contemporary grotesk display face paired with a compact monospace for commands, labels, and architecture. System fallbacks must preserve layout.
- **Geometry:** generous whitespace, hairline borders, oversized headlines, offset grid placements, and soft 20–28px card radii.
- **Motion:** slow phone float, restrained cursor/particle drift, and section reveals. All motion stops under `prefers-reduced-motion: reduce`.

## Page Narrative

### 1. Navigation

Compact P1 wordmark, `How it works`, `Security`, `Commands`, GitHub, and an orange `Open WhatsApp` CTA. It remains legible over both the light hero and dark sections.

### 2. Hero: "Your technology briefing, already in WhatsApp."

The left side uses a short editorial statement and two CTAs. The right side contains a CSS-built, three-dimensional Galaxy-style Android phone with the real digest portion of the supplied WhatsApp screenshot as its screen. The owner-only `/refresh` command is excluded from the crop. Small orange signal glyphs and a subtle dark halo create depth without becoming decorative noise.

Supporting proof remains factual: self-hosted, open source, source-linked answers, bring-your-own Groq key.

### 3. Product demonstration

A dark full-width section reuses the supplied image with a second crop showing P1 declining to invent an unsupported answer and returning exact source URLs. The mistyped question is excluded. Short copy explains grounded technology-news retrieval, per-user sessions, and source-linked answers. The screenshot is the evidence; the copy does not invent output metrics.

### 4. How P1 works

A horizontal signal path explains: WhatsApp → Evolution API → Mastra workflow → MCP/FastAPI → Qdrant → Groq response. On mobile this becomes a vertical sequence. Each stage receives one sentence, not implementation documentation.

### 5. Secure BYOK

Explain the ten-minute setup link, encrypted key storage, WhatsApp confirmation, optional backup key, and account deletion using designed HTML cards rather than exposing a real setup link.

### 6. Start in four steps

Preserve the current `Message P1`, `/register`, add keys, and `/confirm` instructions in a tighter four-step sequence. Groq Console remains linked. Security warnings remain explicit.

### 7. Command deck

Present the existing commands as a dark monospace interface with clear explanations. This is a reference, not an interactive terminal.

### 8. Final CTA and footer

Repeat `Open P1 in WhatsApp`, link the source repository, list the production stack, and retain the usage/provider-cost disclaimer.

## Screenshot Asset

Use the supplied 1080×4283 Android WhatsApp scroll capture as one local asset and create two non-destructive CSS crops:

- **Hero crop:** show the sourced digest and story cards while excluding the owner-only `/refresh` command.
- **Reliability crop:** show P1's grounded refusal and exact source links while excluding the mistyped user question.

No onboarding screenshot is published. Security and registration are explained with designed HTML cards, which avoids exposing setup URLs or tokens. The source screenshot remains unchanged; responsive containers control the visible regions.

## Phone Treatment

The phone is a CSS-built Galaxy-style flagship silhouette: flat front glass, centered hole-punch camera, slim metallic rails, right-side buttons, reflective edge, layered shadow, and a small perspective rotation. The real screenshot is clipped inside the display. The mockup contains no Samsung wordmark, copyrighted product render, or external mockup dependency.

On narrow screens, perspective is reduced and the phone is centered to keep the WhatsApp text readable. The screen image remains an accessible `<img>` with descriptive alt text.

## Implementation Boundaries

- Rewrite `public/index.html` and add only the supplied screenshot assets under `public/assets/`.
- Keep CSS and the small motion script in the page unless splitting them materially improves readability.
- Do not add a build step or runtime dependency.
- Use semantic landmarks, logical heading order, keyboard-visible focus, sufficient contrast, descriptive alt text, and minimum 44px touch targets.
- Add only motion that supports hierarchy or product demonstration.

## Verification

- Run the existing TypeScript check and Node tests to prove the landing-page change did not disturb the application.
- Serve `public/` locally and inspect desktop and mobile widths in Chrome.
- Verify every navigation, WhatsApp, Groq Console, GitHub, and setup-related link.
- Verify no horizontal overflow, clipping, broken images, unreadable phone text, or animation under reduced motion.
- Confirm the Caddy routing configuration is unchanged.
- Confirm the page still conveys all current onboarding and privacy information.

## Remaining Inputs

The user supplied the screenshot and approved implementation. No further content input is required for the first version.

