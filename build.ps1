# Build script for YggTorrent Helper
# Produces a .crx file using Chrome or Brave's built-in packer

$ErrorActionPreference = "Stop"

# Read version from manifest.json
$manifest = Get-Content "$PSScriptRoot\manifest.json" -Raw | ConvertFrom-Json
$version = $manifest.version
$extensionDir = $PSScriptRoot
$keyFile = (Resolve-Path "$PSScriptRoot\..").Path + "\ygg-helper-dl-key.pem"

Write-Host "Building YggTorrent Helper v$version..." -ForegroundColor Cyan

# Find browser binary (Brave or Chrome)
$browser = $null
$candidates = @(
    "$env:LOCALAPPDATA\BraveSoftware\Brave-Browser\Application\brave.exe",
    "C:\Program Files\BraveSoftware\Brave-Browser\Application\brave.exe",
    "C:\Program Files (x86)\BraveSoftware\Brave-Browser\Application\brave.exe",
    "C:\Program Files\Google\Chrome\Application\chrome.exe",
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe",
    "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
)

foreach ($path in $candidates) {
    if (Test-Path $path) {
        $browser = $path
        break
    }
}

if (-not $browser) {
    Write-Host "Error: Neither Brave nor Chrome found." -ForegroundColor Red
    exit 1
}

Write-Host "Using: $browser" -ForegroundColor Gray

# Key is stored outside the extension dir (Brave/Chrome refuses to pack if key is inside)
if (Test-Path $keyFile) {
    Write-Host "Using existing key" -ForegroundColor Gray
} else {
    Write-Host "No key found - a new one will be generated." -ForegroundColor Yellow
    $keyFile = $null
}

try {
    # Build the packer arguments
    $packArgs = @("--pack-extension=$extensionDir")
    if ($keyFile) {
        $packArgs += "--pack-extension-key=$keyFile"
    }

    # Expected output paths (Chrome/Brave puts them next to the extension folder)
    $parentDir = Split-Path $extensionDir -Parent
    $folderName = Split-Path $extensionDir -Leaf
    $expectedCrx = "$parentDir\$folderName.crx"
    $expectedPem = "$parentDir\$folderName.pem"

    # Clean previous output
    if (Test-Path $expectedCrx) { Remove-Item $expectedCrx }

    Write-Host "Packing extension..." -ForegroundColor Gray
    & $browser @packArgs 2>&1 | Where-Object { $_ -notmatch "ERROR.*key file" } | Out-Null

    Start-Sleep -Seconds 2

    if (-not (Test-Path $expectedCrx)) {
        Write-Host "Error: .crx was not created." -ForegroundColor Red
        exit 1
    }

    # Move .crx into the project folder
    $outputCrx = "$extensionDir\ygg-helper-dl-v$version.crx"
    Move-Item $expectedCrx $outputCrx -Force

    # If a new .pem was generated, save it outside the project
    if (Test-Path $expectedPem) {
        $newKeyPath = (Split-Path $extensionDir -Parent) + "\ygg-helper-dl-key.pem"
        Move-Item $expectedPem $newKeyPath -Force
        Write-Host "Generated new key: $newKeyPath - keep this safe!" -ForegroundColor Yellow
    }

    $size = (Get-Item $outputCrx).Length / 1KB
    Write-Host ""
    Write-Host "Built: ygg-helper-dl-v$version.crx ($([math]::Round($size, 1)) KB)" -ForegroundColor Green
    Write-Host ""
    Write-Host "To install:" -ForegroundColor Yellow
    Write-Host "  1. Go to brave://extensions (or chrome://extensions)"
    Write-Host "  2. Enable Developer Mode"
    Write-Host "  3. Drag and drop the .crx file onto the page"
}
finally {
    # Nothing to clean up - key stays outside the project
}
