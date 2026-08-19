$ErrorActionPreference = "Stop"

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$PythonPath = Join-Path $ProjectRoot ".venv\Scripts\python.exe"
$LogDirectory = Join-Path $ProjectRoot "logs"
$OutputLog = Join-Path $LogDirectory "assistant.out.log"
$ErrorLog = Join-Path $LogDirectory "assistant.err.log"

New-Item -ItemType Directory -Path $LogDirectory -Force | Out-Null
Set-Location -LiteralPath $ProjectRoot

& $PythonPath -m stock_assistant run 1>> $OutputLog 2>> $ErrorLog
exit $LASTEXITCODE
