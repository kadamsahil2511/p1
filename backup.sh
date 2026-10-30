#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
umask 077
mkdir -p backups
scratch=$(mktemp -d)
trap 'rm -rf "$scratch"' EXIT
cp .env "$scratch/.env"
mkdir -p data
cp -a data "$scratch/data"
if docker compose ps -q postgres >/dev/null 2>&1 && [[ -n "$(docker compose ps -q postgres)" ]]; then
  docker compose exec -T postgres pg_dump -U evolution evolution > "$scratch/evolution.sql"
  docker cp "$(docker compose ps -q evolution):/evolution/instances" "$scratch/evolution-instances"
fi
archive="backups/p1-$(date -u +%Y%m%dT%H%M%SZ).tar.age"
tar -C "$scratch" -cf - . | age -p > "$archive"
echo "Encrypted backup saved: $archive"
