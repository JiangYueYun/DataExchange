# Compaction pack: prepare a target machine, then self-check.
#
#   pwsh tools/install.ps1 [-ProfileDir <profile dir>]
#
# Creates the node_modules/@deepseek-ai junction the pack's external imports need
# and runs the self-check. It does NOT install the bundle: use the Plugins page
# ("Add plugin" with this directory) or `dsh plugin add <directory>`, so the
# profile manager owns package.json and cordis.patch.yml.

param(
  [string]$ProfileDir = "$env:USERPROFILE\.dsh\profiles\web",
  [string]$DshModules
)

$ErrorActionPreference = 'Stop'
$pack = Split-Path -Parent $PSScriptRoot

if (-not $DshModules) {
  # A profile's own node_modules holds only profile-installed bundles; the DSH
  # installation packages sit one level up (profiles/node_modules) or beside it.
  $candidates = @(
    (Join-Path (Split-Path $ProfileDir -Parent) 'node_modules\@deepseek-ai'),
    (Join-Path $ProfileDir 'node_modules\@deepseek-ai')
  )
  $DshModules = $candidates | Where-Object { Test-Path (Join-Path $_ 'cordis\package.json') } | Select-Object -First 1
}
if (-not (Test-Path (Join-Path $DshModules 'cordis\package.json'))) {
  throw "install: $DshModules has no @deepseek-ai/cordis; pass -DshModules with the DSH installation's node_modules/@deepseek-ai"
}

$link = Join-Path $pack 'node_modules\@deepseek-ai'
New-Item -ItemType Directory -Force -Path (Split-Path $link) | Out-Null
if (Test-Path $link) {
  Write-Host "install: reusing existing $link"
} else {
  cmd /c mklink /J "$link" "$DshModules" | Out-Null
  Write-Host "install: linked $link -> $DshModules"
}

Push-Location $pack
try {
  node tools/selfcheck.mjs
  if ($LASTEXITCODE -ne 0) { throw 'install: selfcheck failed' }
  node tools/client-smoke.mjs
  if ($LASTEXITCODE -ne 0) { throw 'install: client smoke failed' }
} finally {
  Pop-Location
}

Write-Host ''
Write-Host 'install: ready. Next steps:'
Write-Host "  1. Plugins page -> Add plugin -> $pack"
Write-Host '  2. Open a NEW session (existing sessions keep their preset revision)'
Write-Host '  3. Plugins page -> Built-in plugin configuration -> Compaction tuning'
