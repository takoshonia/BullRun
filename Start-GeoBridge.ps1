$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if ($nodeCommand) { $nodePath = $nodeCommand.Source } else {
  $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
}
if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Node.js 24 or newer is required.' }
Write-Host 'Starting GeoBridge. Open http://127.0.0.1:4317'
Write-Host 'Demo passwords are generated on first start in data/demo-credentials.json'
& $nodePath --env-file-if-exists=.env src/server.mjs
