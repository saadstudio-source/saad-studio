$app = Join-Path $PSScriptRoot 'app'
$electron = Join-Path $app 'saad-agent\node_modules\electron\dist\electron.exe'
$entry = Join-Path $app 'deploy-manager\main.cjs'
if (-not (Test-Path -LiteralPath $electron)) { throw 'Electron executable not found' }
Start-Process -FilePath $electron -WorkingDirectory $app -ArgumentList @('"' + $entry + '"')
