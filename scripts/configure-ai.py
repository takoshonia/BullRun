"""Interactive private provider-pool setup. Run as root on the GeoBridge Docker host."""
import getpass
import json
import os
import pathlib
import re
import subprocess
import uuid
import sys
import shutil
from urllib.parse import urlparse

os.umask(0o077)
container = json.loads(subprocess.check_output(['docker', 'inspect', 'geobridge'], text=True))[0]
mount = next(m for m in container['Mounts'] if m['Destination'] == '/app/data' and m.get('Name') == 'geobridge-data')
directory = pathlib.Path(mount['Source']) / 'ai'
if directory.is_symlink():
    raise SystemExit('Refusing a symbolic-link configuration directory.')
directory.mkdir(mode=0o700, exist_ok=True)
os.chown(directory, 1000, 1000)
os.chmod(directory, 0o700)
pool_file = directory / 'providers.json'
if pool_file.is_symlink():
    raise SystemExit('Refusing a symbolic-link pool file.')
data = json.loads(pool_file.read_text()) if pool_file.exists() else {'connections': []}
if not pool_file.exists() and (directory / 'openai.key').is_file() and (directory / 'model').is_file():
    data['connections'].append({'id': 'legacy-openai', 'provider': 'openai', 'model': (directory / 'model').read_text().strip(), 'keyFile': '/app/data/ai/openai.key', 'quotaGroup': 'openai', 'enabled': True})

def private_write(filename, value):
    temporary = directory / (filename + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(value, encoding='utf-8')
    os.chmod(temporary, 0o600)
    os.chown(temporary, 1000, 1000)
    temporary.replace(directory / filename)

def save():
    private_write('providers.json', json.dumps(data, indent=2) + '\n')
    print('Saved. Changes apply at runtime; no restart needed.')

def edit_env():
    filename = directory / 'api-keys.env'
    if filename.is_symlink():
        raise SystemExit('Refusing a symbolic-link credential file.')
    editor = shutil.which('nano') or shutil.which('vi')
    if not editor:
        raise SystemExit('Install nano, or upload api-keys.env into the private ai directory.')
    if not filename.exists():
        private_write('api-keys.env', '# Paste provider keys here. Numbered suffixes are discovered automatically.\n# Enter exact model IDs; empty model values disable that provider.\nGEMINI_MODEL=\nGOOGLE_API_KEY=\nOPENAI_MODEL=\nOPENAI_API_KEY=\nCLAUDE_MODEL=\nANTHROPIC_API_KEY=\nGROK_MODEL=\nXAI_API_KEY=\n')
    try:
        subprocess.run([editor, str(filename)], check=True)
    finally:
        os.chmod(filename, 0o600)
        os.chown(filename, 1000, 1000)
    print('Saved private credential file. It takes precedence over menu connections; no restart needed.')
    code = "import {aiConfig} from '/app/src/ai-config.mjs'; const c=aiConfig(); console.log(JSON.stringify({configuredConnections:c.connections.length,warnings:c.warnings||[]}))"
    subprocess.run(['docker', 'exec', 'geobridge', 'node', '--input-type=module', '-e', code], check=True)

if '--edit-env' in sys.argv:
    edit_env()
    raise SystemExit(0)

while True:
    print('\n1 Add/update connection  2 List  3 Disable  4 Enable  5 Move to first  6 Remove connection  7 Edit bulk key file  0 Exit')
    action = input('Choose: ').strip()
    if action == '0':
        break
    if action == '7':
        edit_env()
        continue
    if (directory / 'api-keys.env').exists():
        print('Bulk api-keys.env is active and takes precedence over menu connections. Use option 7 to edit it.')
    if action == '2':
        for index, entry in enumerate(data['connections'], 1):
            print(index, entry['id'], entry['provider'], entry['model'], 'enabled' if entry.get('enabled', True) else 'disabled')
        continue
    if action not in ['1', '3', '4', '5', '6']:
        continue
    identity = input('Connection name (letters, digits, underscore, hyphen): ').strip()
    if not re.fullmatch(r'[a-zA-Z0-9_-]{1,80}', identity):
        print('Invalid name.')
        continue
    existing = next((e for e in data['connections'] if e['id'] == identity), None)
    if action != '1':
        if not existing:
            print('Connection not found.')
            continue
        if action in ['3', '4']:
            existing['enabled'] = action == '4'
        if action in ['5', '6']:
            data['connections'].remove(existing)
        if action == '5':
            data['connections'].insert(0, existing)
        save()
        continue
    provider = input('Provider: openai / gemini / claude / grok / compatible: ').strip().lower()
    if provider not in ['openai', 'gemini', 'claude', 'grok', 'compatible']:
        print('Unknown provider; use compatible for another OpenAI-compatible service.')
        continue
    model = input('Exact API model ID supporting structured JSON output: ').strip()
    group = input('Quota group (same project/account = same group; Enter for provider default): ').strip() or provider
    base_url = None
    if provider == 'compatible':
        base_url = input('HTTPS API base URL, e.g. https://your-provider.example/v1: ').strip().rstrip('/')
        url = urlparse(base_url)
        if url.scheme != 'https' or not url.hostname or url.username or url.password or url.query or url.fragment:
            print('Invalid HTTPS base URL.')
            continue
    key = getpass.getpass('API key (hidden): ').strip()
    if not model or len(model) > 200 or not key or any(c.isspace() for c in model + key):
        print('A model ID and key without whitespace are required.')
        continue
    key_name = identity + '.key'
    private_write(key_name, key + '\n')
    entry = {'id': identity, 'provider': provider, 'model': model, 'keyFile': '/app/data/ai/' + key_name, 'quotaGroup': group, 'enabled': True}
    if base_url:
        entry['baseUrl'] = base_url
    if existing:
        data['connections'][data['connections'].index(existing)] = entry
    else:
        data['connections'].append(entry)
    save()
