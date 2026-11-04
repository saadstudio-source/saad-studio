$root = Split-Path -Parent $PSScriptRoot
$electron = Join-Path $root 'saad-agent\node_modules\electron\dist\electron.exe'
$entry = Join-Path $root 'deploy-manager\main.cjs'
if (-not (Test-Path -LiteralPath $electron)) { throw "Electron executable not found: $electron" }
Start-Process -FilePath $electron -WorkingDirectory $root -ArgumentList @('"' + $entry + '"')
