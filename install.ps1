$ErrorActionPreference = "Stop"

$RepoZip = "https://github.com/dix105/wisper-cli/archive/refs/heads/master.zip"
$InstallDir = if ($env:WISPER_INSTALL_DIR) { $env:WISPER_INSTALL_DIR } else { Join-Path $env:USERPROFILE ".wisper-cli\app" }
$BinDir = if ($env:WISPER_BIN_DIR) { $env:WISPER_BIN_DIR } else { Join-Path $env:USERPROFILE ".local\bin" }
$BinPath = Join-Path $BinDir "wisper.cmd"
$TmpDir = Join-Path $env:TEMP ("wisper-cli-" + [guid]::NewGuid().ToString())

function Need($Command, $InstallHint) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    Write-Error "Missing required command: $Command`n$InstallHint"
    exit 1
  }
}

Need "node" "Install Node.js from https://nodejs.org, then reopen terminal."
Need "npm" "Install Node.js from https://nodejs.org, then reopen terminal."

New-Item -ItemType Directory -Force -Path $TmpDir, $BinDir | Out-Null

try {
  $ZipPath = Join-Path $TmpDir "wisper-cli.zip"
  Write-Host "Downloading Wisper CLI..."
  Invoke-WebRequest -Uri $RepoZip -OutFile $ZipPath

  Write-Host "Extracting..."
  Expand-Archive -Path $ZipPath -DestinationPath $TmpDir -Force

  if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
  }

  $InstallParent = Split-Path -Parent $InstallDir
  New-Item -ItemType Directory -Force -Path $InstallParent | Out-Null
  $SourceDir = Get-ChildItem -Path $TmpDir -Directory | Where-Object { $_.Name -like "wisper-cli-*" } | Select-Object -First 1
  if (-not $SourceDir) {
    throw "Could not find extracted wisper-cli source folder."
  }
  Move-Item $SourceDir.FullName $InstallDir

  Push-Location $InstallDir
  try {
    Write-Host "Installing dependencies..."
    npm install --silent

    Write-Host "Building CLI..."
    npm run build --silent
  } finally {
    Pop-Location
  }

  $CliPath = Join-Path $InstallDir "dist\cli.js"
  Set-Content -Path $BinPath -Value "@echo off`r`nnode `"$CliPath`" %*`r`n" -Encoding ASCII

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $PathParts = @()
  if ($UserPath) { $PathParts = $UserPath -split ";" }
  if ($PathParts -notcontains $BinDir) {
    $NewPath = if ($UserPath) { "$UserPath;$BinDir" } else { $BinDir }
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    $env:Path = "$env:Path;$BinDir"
    Write-Host "Added $BinDir to your user PATH. Open a new terminal if 'wisper' is not found immediately."
  }

  Write-Host ""
  Write-Host "Wisper CLI installed."
  Write-Host "Run: wisper setup"
} finally {
  if (Test-Path $TmpDir) {
    Remove-Item $TmpDir -Recurse -Force
  }
}
