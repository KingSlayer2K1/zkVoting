$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

$snarkjs = Join-Path $root "node_modules\.bin\snarkjs.cmd"
$nodeInputScript = Join-Path $root "scripts\node\generate-step4-input.js"
$nodePayloadScript = Join-Path $root "scripts\node\build-step4-payload.js"
$step4Dir = Join-Path $root "circuits\build\step4"

$wasm = Join-Path $root "circuits\build\vote_validity_js\vote_validity.wasm"
$zkey = Join-Path $root "circuits\keys\vote_validity_final.zkey"
$verificationKey = Join-Path $root "circuits\keys\verification_key.json"

if (-not (Test-Path $snarkjs)) {
  throw "snarkjs not found. Run npm.cmd install first."
}
if (-not (Test-Path $wasm)) {
  throw "WASM artifact not found at $wasm. Run Step 3 first."
}
if (-not (Test-Path $zkey)) {
  throw "ZKey not found at $zkey. Run Step 3 first."
}
if (-not (Test-Path $verificationKey)) {
  throw "Verification key not found at $verificationKey. Run Step 3 first."
}

New-Item -ItemType Directory -Force -Path $step4Dir | Out-Null

Write-Host "Generating Step 4 input..."
node $nodeInputScript

$inputJson = Join-Path $step4Dir "input.json"
$proofJson = Join-Path $step4Dir "proof.json"
$publicJson = Join-Path $step4Dir "public.json"

foreach ($file in @($proofJson, $publicJson)) {
  if (Test-Path $file) {
    Remove-Item -Force $file
  }
}

Write-Host "Generating Groth16 proof..."
& $snarkjs groth16 fullprove $inputJson $wasm $zkey $proofJson $publicJson

Write-Host "Verifying proof locally..."
& $snarkjs groth16 verify $verificationKey $publicJson $proofJson

Write-Host "Building API payload template..."
node $nodePayloadScript

Write-Host ""
Write-Host "Step 4 complete."
Write-Host "Artifacts written to: $step4Dir"

