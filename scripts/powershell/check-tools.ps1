$ErrorActionPreference = "Stop"

Write-Host "Node version:"
node --version

Write-Host ""
Write-Host "snarkjs version:"
npx.cmd snarkjs --version

Write-Host ""
Write-Host "circom version:"
$circomExe = Join-Path (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path "scripts\bin\circom.exe"
if (Test-Path $circomExe) {
  & $circomExe --version
} else {
  npx.cmd circom2 --version
}
