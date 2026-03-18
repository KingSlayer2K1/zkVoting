$ErrorActionPreference = "Stop"

$root = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
Set-Location $root

$circomExe = Join-Path $root "scripts\bin\circom.exe"
$snarkjs = Join-Path $root "node_modules\.bin\snarkjs.cmd"
$circuitFile = Join-Path $root "circuits\vote_validity.circom"
$buildDir = Join-Path $root "circuits\build"
$keysDir = Join-Path $root "circuits\keys"

if (-not (Test-Path $circomExe)) {
  throw "circom.exe not found at $circomExe. Download it first (Step 3 setup path)."
}

if (-not (Test-Path $snarkjs)) {
  throw "snarkjs binary not found at $snarkjs. Run npm.cmd install first."
}

if (-not (Test-Path $buildDir)) {
  New-Item -ItemType Directory -Path $buildDir | Out-Null
}

if (-not (Test-Path $keysDir)) {
  New-Item -ItemType Directory -Path $keysDir | Out-Null
}

Write-Host "Compiling circuit with Circom..."
if (Test-Path (Join-Path $root "circuits\vote_validity_js")) {
  Remove-Item -Recurse -Force (Join-Path $root "circuits\vote_validity_js")
}

& $circomExe $circuitFile --r1cs --wasm --sym -o (Join-Path $root "circuits")

Move-Item -Force (Join-Path $root "circuits\vote_validity.r1cs") (Join-Path $buildDir "vote_validity.r1cs")
Move-Item -Force (Join-Path $root "circuits\vote_validity.sym") (Join-Path $buildDir "vote_validity.sym")
if (Test-Path (Join-Path $buildDir "vote_validity_js")) {
  Remove-Item -Recurse -Force (Join-Path $buildDir "vote_validity_js")
}
Move-Item -Force (Join-Path $root "circuits\vote_validity_js") (Join-Path $buildDir "vote_validity_js")

Write-Host "Running Powers of Tau and Groth16 setup..."

$ptau0 = Join-Path $keysDir "pot14_0000.ptau"
$ptau1 = Join-Path $keysDir "pot14_0001.ptau"
$ptauFinal = Join-Path $keysDir "pot14_final.ptau"
$zkey0 = Join-Path $keysDir "vote_validity_0000.zkey"
$zkeyFinal = Join-Path $keysDir "vote_validity_final.zkey"
$vkey = Join-Path $keysDir "verification_key.json"
$entropy = "zkVoting-step3-" + (Get-Date -Format "yyyyMMddHHmmss")

foreach ($f in @($ptau0, $ptau1, $ptauFinal, $zkey0, $zkeyFinal, $vkey)) {
  if (Test-Path $f) {
    Remove-Item -Force $f
  }
}

& $snarkjs powersoftau new bn128 14 $ptau0
& $snarkjs powersoftau contribute $ptau0 $ptau1 --name="Step3-PTAU" -e=$entropy
& $snarkjs powersoftau prepare phase2 $ptau1 $ptauFinal

& $snarkjs groth16 setup (Join-Path $buildDir "vote_validity.r1cs") $ptauFinal $zkey0
& $snarkjs zkey contribute $zkey0 $zkeyFinal --name="Step3-ZKEY" -e=$entropy
& $snarkjs zkey export verificationkey $zkeyFinal $vkey
& $snarkjs zkey verify (Join-Path $buildDir "vote_validity.r1cs") $ptauFinal $zkeyFinal

Write-Host ""
Write-Host "Step 3 complete."
Write-Host "Build artifacts: $buildDir"
Write-Host "Trusted setup artifacts: $keysDir"

