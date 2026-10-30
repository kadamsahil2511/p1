"""Set or check local service secrets without displaying their values."""
import argparse
import getpass
import os
from pathlib import Path

ALLOWED = {'GROQ_API_KEY', 'GROQ_BACKUP_API_KEY', 'ACCOUNT_ENCRYPTION_KEY', 'EVOLUTION_API_KEY', 'P1_API_TOKEN', 'WEBHOOK_SECRET', 'POSTGRES_PASSWORD', 'WHATSAPP_OWNER_NUMBER'}


def update(path: Path, key: str, value: str) -> None:
    if key not in ALLOWED or not value or '\n' in value or '\r' in value:
        raise ValueError('Invalid key or value')
    lines = path.read_text().splitlines() if path.exists() else []
    lines = [line for line in lines if not line.startswith(key + '=')]
    lines.append(f'{key}={value}')
    temporary = path.with_suffix('.tmp')
    temporary.write_text('\n'.join(lines) + '\n')
    temporary.chmod(0o600)
    os.replace(temporary, path)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['status', 'set'])
    parser.add_argument('key', nargs='?', choices=sorted(ALLOWED))
    args = parser.parse_args()
    path = Path(__file__).with_name('.env')
    if args.action == 'status':
        values = dict(line.split('=', 1) for line in path.read_text().splitlines() if '=' in line) if path.exists() else {}
        for key in sorted(ALLOWED): print(f'{key}: {"set" if values.get(key) else "missing"}')
        return
    if not args.key: parser.error('set needs a key')
    value = getpass.getpass(f'{args.key}: ')
    update(path, args.key, value)
    print(f'{args.key} updated. Restart the services to apply it.')


if __name__ == '__main__':
    main()
