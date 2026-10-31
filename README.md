# P1 Assistant

P1 Assistant is a self-hosted WhatsApp assistant for conversation and technology news. A Mastra workflow retrieves articles, its agent handles Groq chat and per-user memory, and a private MCP server calls the FastAPI P1 API. The API manages a defined source pool and local Qdrant search. The linked WhatsApp account runs through Evolution API.

**Public guide:** [p1.kadamsahil.com](https://p1.kadamsahil.com) explains WhatsApp registration, key setup, and commands. It is served as a static page by Caddy. The `/setup` route stays on the private session-backed application; it cannot be opened without a short-lived link sent in WhatsApp.

## Setup and start

Use Python 3.12+ and Node 22+. From this directory:

```sh
npm ci
python3 -m venv .venv
.venv/bin/pip install -r requirements-api.txt pytest
cp .env.example .env
# Fill in the .env values. Generate ACCOUNT_ENCRYPTION_KEY with: openssl rand -base64 32
./run.sh
```

`npm run check`, `npm test`, and `.venv/bin/python -m pytest -q test_api.py test_sources.py test_news_store.py test_mcp_server.py test_keys.py` verify the two layers. Stop with Ctrl+C. Runtime logs use JSON stage names such as `server.ready`, `digest.start`, `whatsapp.sent`, and `schedule.failed`. `GET http://127.0.0.1:3000/health` checks the webhook service; `GET http://127.0.0.1:8766/health` checks the P1 API.

The local `.env` uses `http://127.0.0.1:3000` for setup tests. A phone cannot open that localhost address; actual WhatsApp signup uses the VPS `SETUP_BASE_URL=https://p1.kadamsahil.com` and Caddy TLS.

Set the Evolution API instance webhook to `http://host.docker.internal:3000/webhook/<WEBHOOK_SECRET>` if Evolution runs in Docker on the same computer, or to the host's private network address on a server. Subscribe to `MESSAGES_UPSERT`. The webhook accepts inbound direct messages; groups are ignored. The Evolution API port and Mastra webhook stay private. Pair a dedicated WhatsApp number with the Evolution instance's QR code. The owner number is your personal WhatsApp number, in international digits without `+`.

Commands: `/register`, `/confirm <code>`, `/account`, `/deleteaccount`, `/help`, `/newchat`, `/latest`, `/ask <question>`, `/sources`. Only the owner can use `/addsource <https-url>`, `/removesource <id>`, and `/refresh`. Any direct-message sender can register. `/register` sends a ten-minute HTTPS setup link; the page asks for a required Primary Groq key and optional, different Backup Groq key. The server checks each key against Groq's model list, then sends a confirmation code to that WhatsApp number. Only `/confirm <code>` from the same number activates the encrypted keys. A new registration replaces both keys; leaving Backup blank removes it. The bot does not accept keys in chat. Tapping the link may open WhatsApp's in-app browser, depending on the phone's settings.

Plain messages are normal chat after registration. Each number gets separate Mastra memory; a new thread starts after one idle hour. The backup key is tried only after the primary model request fails. The existing 07:00 IST digest and shared source administration remain owner-only. `/refresh` and the schedule select only stories missing from the delivery ledger. A story enters that ledger only after Evolution accepts the WhatsApp message. The ledger, encrypted account database, Mastra SQLite memory, source registry, and Qdrant files are under `data/` and must be included in backups. Keep `ACCOUNT_ENCRYPTION_KEY` with those backups: without it, stored user keys cannot be recovered.

Website search uses local lexical Qdrant retrieval, so source terms in the question improve matches. Scraping honors robots rules and does not bypass paywalls.

## Hostinger KVM 1 deployment

The stack lives in `/opt/p1` on Hostinger KVM 1. Compose runs P1, Caddy, Evolution, PostgreSQL, and Redis. Caddy serves the public guide and `/setup` over HTTPS on `p1.kadamsahil.com`; P1 and Evolution bind to server loopback, and Evolution calls the webhook over the private Compose network. The apex and `www` DNS records are unchanged.

Evolution v2.3.7's bundled Baileys cannot complete new WhatsApp device pairing. `Dockerfile.evolution` installs Baileys rc14 and applies the narrow, version-pinned [upstream pairing patch](https://github.com/evolution-foundation/evolution-api/pull/2727). Remove that patch once an official Evolution release includes the fix; keep the PostgreSQL and WhatsApp volumes across image updates.

On the server:

```sh
cd /opt/p1
docker compose ps
docker compose logs -f p1 evolution
docker compose up -d
docker compose stop p1
docker compose down                 # preserves database and WhatsApp volumes
```

Set `WHATSAPP_OWNER_NUMBER` in the mode-0600 `.env` file to international digits without `+`. Pair the dedicated bot number to the `p1` Baileys instance. An SSH tunnel to server loopback port 8080 opens the private Evolution Manager at `/manager/`. After pairing, start P1 with `docker compose start p1`. Check `curl http://127.0.0.1:3000/health` on the server. The P1 API listens inside the P1 container on `127.0.0.1:8765`.

Use `./backup.sh` from a terminal with `age` installed to create a passphrase-encrypted archive of `.env`, app data, the Evolution PostgreSQL dump, and linked WhatsApp instance files. Keep the passphrase and archive away from the VM. To restore, decrypt with `age -d` and extract the tar, then restore the SQL dump and instance files before restarting Compose. `docker compose down` stops the stack without deleting volumes; do not use `down -v` unless you intend to erase Evolution data.

Manage secrets with `python keys.py status` and `python keys.py set GROQ_API_KEY` (or another listed key). Values are entered without echo and are never printed by `status`. Restart Compose after rotating a key. The `.env` file is ignored by Git and mode `0600`.

## CI/CD

The [GitHub Actions workflow](.github/workflows/ci-cd.yml) runs TypeScript checks, Node tests, Python tests, and Compose validation for pushes and pull requests. A successful push to `main` syncs code to `/opt/p1`, rebuilds the Compose stack, and checks the private health endpoint. The `production` job uses a dedicated `p1deploy` SSH user and pinned server host key. Set repository secrets `DEPLOY_SSH_KEY` and `DEPLOY_KNOWN_HOSTS`; application credentials remain only in the VPS `.env`.
