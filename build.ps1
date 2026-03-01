# Build script for YggTorrent Helper
# Produces a .zip (recommended) and .crx package

$ErrorActionPreference = "Stop"

# Read version from manifest.json
$manifest = Get-Content "$PSScriptRoot\manifest.json" -Raw | ConvertFrom-Json
$version = $manifest.version
$extensionDir = $PSScriptRoot
$keyFile = (Resolve-Path "$PSScriptRoot\..").Path + "\ygg-helper-dl-key.pem"

Write-Host "Building YggTorrent Helper v$version..." -ForegroundColor Cyan

# --- Files to include ---
$includeFiles = @(
    "manifest.json",
    "background.js",
    "content.js",
    "content.css",
    "popup.html",
    "popup.js",
    "popup.css",
    "icons\icon16.png",
    "icons\icon48.png",
    "icons\icon128.png"
)

# ============================================================
# ZIP BUILD (recommended for distribution)
# ============================================================

$outputZip = "$extensionDir\ygg-helper-dl-v$version.zip"
if (Test-Path $outputZip) { Remove-Item $outputZip }

Write-Host "Creating .zip..." -ForegroundColor Gray

# Build zip using .NET ZipArchive to ensure forward-slash paths (ZIP spec requirement).
# Compress-Archive uses backslashes on Windows, which some browsers can't resolve.
Add-Type -AssemblyName System.IO.Compression
Add-Type -AssemblyName System.IO.Compression.FileSystem

$zipStream = [System.IO.File]::Create($outputZip)
$archive = New-Object System.IO.Compression.ZipArchive($zipStream, [System.IO.Compression.ZipArchiveMode]::Create)

foreach ($file in $includeFiles) {
    $src = "$extensionDir\$file"
    if (Test-Path $src) {
        # Use forward slashes for ZIP entry names (per ZIP spec)
        $entryName = $file.Replace('\', '/')
        [System.IO.Compression.ZipFileExtensions]::CreateEntryFromFile($archive, $src, $entryName) | Out-Null
    } else {
        Write-Host "Warning: $file not found, skipping" -ForegroundColor Yellow
    }
}

$archive.Dispose()
$zipStream.Dispose()

$zipSize = (Get-Item $outputZip).Length / 1KB
Write-Host "Built: ygg-helper-dl-v$version.zip ($([math]::Round($zipSize, 1)) KB)" -ForegroundColor Green

# ============================================================
# CRX BUILD (optional, requires Chrome/Brave)
# ============================================================

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
    Write-Host ""
    Write-Host "Skipping .crx build: neither Brave nor Chrome found." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "To install (Load unpacked):" -ForegroundColor Yellow
    Write-Host "  1. Unzip ygg-helper-dl-v$version.zip"
    Write-Host "  2. Go to brave://extensions (or chrome://extensions)"
    Write-Host "  3. Enable Developer Mode"
    Write-Host '  4. Click "Load unpacked" and select the unzipped folder'
    exit 0
}

Write-Host ""
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

    Write-Host "Packing .crx..." -ForegroundColor Gray
    & $browser @packArgs 2>&1 | Where-Object { $_ -notmatch "ERROR.*key file" } | Out-Null

    Start-Sleep -Seconds 2

    if (-not (Test-Path $expectedCrx)) {
        Write-Host "Warning: .crx was not created (browser may not support packing)." -ForegroundColor Yellow
    } else {
        # Move .crx into the project folder
        $outputCrx = "$extensionDir\ygg-helper-dl-v$version.crx"
        Move-Item $expectedCrx $outputCrx -Force

        # If a new .pem was generated, save it outside the project
        if (Test-Path $expectedPem) {
            $newKeyPath = (Split-Path $extensionDir -Parent) + "\ygg-helper-dl-key.pem"
            Move-Item $expectedPem $newKeyPath -Force
            Write-Host "Generated new key: $newKeyPath - keep this safe!" -ForegroundColor Yellow
        }

        $crxSize = (Get-Item $outputCrx).Length / 1KB
        Write-Host "Built: ygg-helper-dl-v$version.crx ($([math]::Round($crxSize, 1)) KB)" -ForegroundColor Green
    }
}
catch {
    Write-Host "Warning: .crx build failed: $_" -ForegroundColor Yellow
    Write-Host "The .zip was still created successfully." -ForegroundColor Gray
}

Write-Host ""
Write-Host "To install (recommended):" -ForegroundColor Yellow
Write-Host "  1. Unzip ygg-helper-dl-v$version.zip"
Write-Host "  2. Go to brave://extensions (or chrome://extensions)"
Write-Host "  3. Enable Developer Mode"
Write-Host '  4. Click "Load unpacked" and select the unzipped folder'
Write-Host ""
Write-Host "Note: .crx sideloading is blocked by Chromium browsers since 2019." -ForegroundColor DarkGray
Write-Host "The .crx is provided for enterprise deployment only." -ForegroundColor DarkGray
