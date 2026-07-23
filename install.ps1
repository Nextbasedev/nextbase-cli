$ErrorActionPreference = "Stop"

$RepoZip = "https://github.com/Nextbasedev/nextbase-cli/archive/refs/heads/master.zip"
$InstallRoot = if ($env:WISPER_INSTALL_ROOT) { $env:WISPER_INSTALL_ROOT } else { Join-Path $env:USERPROFILE ".wisper-cli" }
$InstallDir = if ($env:WISPER_INSTALL_DIR) { $env:WISPER_INSTALL_DIR } else { Join-Path $InstallRoot "app" }
$BinDir = if ($env:WISPER_BIN_DIR) { $env:WISPER_BIN_DIR } else { Join-Path $env:USERPROFILE ".local\bin" }
$NextbaseBinPath = Join-Path $BinDir "nextbase.cmd"
$BinPath = Join-Path $BinDir "wisper.cmd"
$NoteBotBinPath = Join-Path $BinDir "notebot.cmd"
$TmpDir = Join-Path $env:TEMP ("wisper-cli-" + [guid]::NewGuid().ToString())

function Need($Command, $InstallHint) {
  if (-not (Get-Command $Command -ErrorAction SilentlyContinue)) {
    Write-Error "Missing required command: $Command`n$InstallHint"
    exit 1
  }
}

function Run($Exe, $Arguments) {
  & $Exe @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "$Exe failed with exit code $LASTEXITCODE"
  }
}

function Stop-ExistingNextbaseProcesses($InstallDir, $InstallRoot) {
  Write-Host "Stopping existing Wisper/NoteBot processes..."
  $PidFiles = @(
    (Join-Path $InstallRoot "listener.pid"),
    (Join-Path $env:USERPROFILE ".notebot\dashboard.pid")
  )

  foreach ($PidFile in $PidFiles) {
    if (Test-Path $PidFile) {
      try {
        $PidValue = [int](Get-Content $PidFile -ErrorAction Stop | Select-Object -First 1)
        Stop-Process -Id $PidValue -Force -ErrorAction SilentlyContinue
        Remove-Item $PidFile -Force -ErrorAction SilentlyContinue
      } catch {}
    }
  }

  try {
    $EscapedInstallDir = [regex]::Escape($InstallDir)
    Get-CimInstance Win32_Process -ErrorAction SilentlyContinue |
      Where-Object { $_.CommandLine -and $_.CommandLine -match $EscapedInstallDir -and $_.ProcessId -ne $PID } |
      ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  } catch {}

  Start-Sleep -Milliseconds 700
}

Need "node" "Install Node.js from https://nodejs.org, then reopen terminal."
Need "npm" "Install Node.js from https://nodejs.org, then reopen terminal."

if (-not (Get-Command "sox" -ErrorAction SilentlyContinue)) {
  Write-Host "SoX is required for microphone recording. Trying to install with winget..."
  if (Get-Command "winget" -ErrorAction SilentlyContinue) {
    & winget install --id ChrisBagwell.SoX --source winget --accept-package-agreements --accept-source-agreements
    if ($LASTEXITCODE -ne 0) {
      Write-Host "Automatic SoX install failed. Run manually: winget install ChrisBagwell.SoX"
    }
  } else {
    Write-Host "winget not found. Install SoX manually: winget install ChrisBagwell.SoX"
  }
}

New-Item -ItemType Directory -Force -Path $TmpDir, $BinDir, $InstallRoot | Out-Null

try {
  $ZipPath = Join-Path $TmpDir "wisper-cli.zip"
  $StageDir = Join-Path $TmpDir "stage"
  $NpmCache = Join-Path $TmpDir "npm-cache"

  Write-Host "Downloading Wisper CLI..."
  Invoke-WebRequest -Uri $RepoZip -OutFile $ZipPath

  Write-Host "Extracting..."
  Expand-Archive -Path $ZipPath -DestinationPath $TmpDir -Force

  $SourceDir = Get-ChildItem -Path $TmpDir -Directory | Where-Object { $_.Name -like "nextbase-cli-*" } | Select-Object -First 1
  if (-not $SourceDir) {
    throw "Could not find extracted nextbase-cli source folder."
  }

  Move-Item $SourceDir.FullName $StageDir

  Push-Location $StageDir
  try {
    Write-Host "Installing dependencies..."
    $env:NODE_ENV = "development"
    $env:npm_config_production = "false"
    $env:npm_config_cache = $NpmCache
    Run "npm" @("install", "--include=dev", "--production=false", "--cache", $NpmCache, "--silent")

    if (-not (Test-Path (Join-Path $StageDir "node_modules\clipboardy"))) {
      throw "Dependency install failed: node_modules\clipboardy not found."
    }
    if (-not (Test-Path (Join-Path $StageDir "node_modules\@types\node"))) {
      Write-Host "Installing missing Node types..."
      Run "npm" @("install", "--save-dev", "@types/node", "typescript", "--cache", $NpmCache, "--silent")
    }

    Write-Host "Building CLI..."
    Run "npm" @("run", "build", "--silent")
    if (-not (Test-Path (Join-Path $StageDir "dist\cli.js"))) {
      Write-Host "Local TypeScript build did not produce dist; trying npx fallback..."
      Run "npx" @("--yes", "--cache", $NpmCache, "-p", "typescript", "-p", "@types/node", "tsc", "-p", "tsconfig.json")
    }
  } finally {
    Pop-Location
  }

  $RequiredDistFiles = @("dist\nextbase-cli.js", "dist\cli.js", "dist\notebot-cli.js")
  foreach ($Required in $RequiredDistFiles) {
    if (-not (Test-Path (Join-Path $StageDir $Required))) {
      throw "Build completed but $Required was not found. Install aborted without touching current install."
    }
  }

  Stop-ExistingNextbaseProcesses $InstallDir $InstallRoot

  if (Test-Path $InstallDir) {
    Remove-Item $InstallDir -Recurse -Force
  }
  Move-Item $StageDir $InstallDir

  $FinalNextbaseCliPath = Join-Path $InstallDir "dist\nextbase-cli.js"
  $FinalCliPath = Join-Path $InstallDir "dist\cli.js"
  $FinalNoteBotCliPath = Join-Path $InstallDir "dist\notebot-cli.js"
  Set-Content -Path $NextbaseBinPath -Value "@echo off`r`nnode `"$FinalNextbaseCliPath`" %*`r`n" -Encoding ASCII
  Set-Content -Path $BinPath -Value "@echo off`r`nnode `"$FinalCliPath`" %*`r`n" -Encoding ASCII
  Set-Content -Path $NoteBotBinPath -Value "@echo off`r`nnode `"$FinalNoteBotCliPath`" %*`r`n" -Encoding ASCII

  try {
    $Commit = Invoke-RestMethod -Uri "https://api.github.com/repos/Nextbasedev/nextbase-cli/commits/master?x=$(Get-Random)" -Headers @{ "User-Agent" = "wisper-cli-installer" }
    if ($Commit.sha) { Set-Content -Path (Join-Path $InstallRoot "installed-sha") -Value $Commit.sha }
  } catch {
    Write-Host "Could not record installed version marker. Auto-update will initialize it on first check."
  }

  $UserPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $PathParts = @()
  if ($UserPath) { $PathParts = $UserPath -split ";" }
  if ($PathParts -notcontains $BinDir) {
    $NewPath = if ($UserPath) { "$UserPath;$BinDir" } else { $BinDir }
    [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
    $env:Path = "$env:Path;$BinDir"
    Write-Host "Added $BinDir to your user PATH. Open a new terminal if 'nextbase' is not found immediately."
  }

  Write-Host ""
  Write-Host "Nextbase CLI installed."
  Write-Host "Run: nextbase"
} finally {
  if (Test-Path $TmpDir) {
    Remove-Item $TmpDir -Recurse -Force
  }
}
