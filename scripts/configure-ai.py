"""Run as root on the GeoBridge Docker host. Never stores the key in Git or shell history."""
import getpass
import json
import os
import pathlib
import subprocess
import uuid

os.umask(0o077)
container = json.loads(subprocess.check_output(['docker', 'inspect', 'geobridge'], text=True))[0]
mount = next(m for m in container['Mounts'] if m['Destination'] == '/app/data' and m.get('Name') == 'geobridge-data')
directory = pathlib.Path(mount['Source']) / 'ai'
if directory.is_symlink():
    raise SystemExit('Refusing a symbolic-link configuration directory.')
directory.mkdir(mode=0o700, exist_ok=True)
os.chown(directory, 1000, 1000)
os.chmod(directory, 0o700)
model = input('OpenAI API model ID (must support Responses and Structured Outputs): ').strip()
key = getpass.getpass('OpenAI API key (hidden): ').strip()
if not model or not key or any(c.isspace() for c in model + key):
    raise SystemExit('A model ID and API key without whitespace are required.')
for name, value in [('model', model), ('openai.key', key)]:
    temporary = directory / (name + '.' + uuid.uuid4().hex + '.tmp')
    temporary.write_text(value + '\n', encoding='utf-8')
    os.chmod(temporary, 0o600)
    os.chown(temporary, 1000, 1000)
    temporary.replace(directory / name)
print('Saved in the private GeoBridge data volume. New audits and requested explanations will use AI; no restart needed.')
