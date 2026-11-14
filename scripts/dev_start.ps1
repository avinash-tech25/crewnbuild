<#
.SYNOPSIS
  Start, stop or check the whole CREWNBUILD platform on this machine (Windows).

.DESCRIPTION
  Runs, in the background, after the one-time setup in README.md ("Running locally"):

    professional-api        http://127.0.0.1:8000   (uvicorn --reload)
    partner-api             http://127.0.0.1:8200   (uvicorn --reload)
    professional-scheduler  python -m app.jobs.run_scheduler
    partner-scheduler       python -m app.jobs.run_scheduler
    professional-web        http://localhost:5173   (Vite)
    partner-web             http://localhost:5373   (Vite)

  Each process writes to .dev\logs\<name>.out.log and .err.log; what was started is kept in
  .dev\processes.json so "stop" ends exactly those processes and their children. Nothing
  here reads or prints a .env file: each backend reads its own.

.EXAMPLE
  .\scripts\dev_start.ps1            # start everything and wait until it answers
  .\scripts\dev_start.ps1 status     # what is running
  .\scripts\dev_start.ps1 stop       # stop everything this script started
  .\scripts\dev_start.ps1 restart
#>
param(
  [ValidateSet('start', 'stop', 'status', 'restart')]
  [string]$Command = 'start',
  # Seconds to wait for each part to answer after starting.
  [int]$TimeoutSeconds = 90
)

$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
$RunDir = Join-Path $Root '.dev'
$LogDir = Join-Path $RunDir 'logs'
$StateFile = Join-Path $RunDir 'processes.json'

function Get-Parts {
  $proPython = Join-Path $Root 'professional\backend\.venv\Scripts\python.exe'
  $partnerPython = Join-Path $Root 'partner\backend\.venv\Scripts\python.exe'
  @(
    @{ Name = 'professional-api'; Dir = 'professional\backend'; Exe = $proPython
       Args = '-m uvicorn app.main:app --reload --host 127.0.0.1 --port 8000'; Port = 8000; Url = 'http://127.0.0.1:8000/api/v1/health/db' }
    @{ Name = 'partner-api'; Dir = 'partner\backend'; Exe = $partnerPython
       Args = '-m uvicorn app.main:app --reload --host 127.0.0.1 --port 8200'; Port = 8200; Url = 'http://127.0.0.1:8200/api/v1/health/db' }
    @{ Name = 'professional-scheduler'; Dir = 'professional\backend'; Exe = $proPython; Args = '-m app.jobs.run_scheduler' }
    @{ Name = 'partner-scheduler'; Dir = 'partner\backend'; Exe = $partnerPython; Args = '-m app.jobs.run_scheduler' }
    @{ Name = 'professional-web'; Dir = 'professional\frontend'; Exe = 'npm.cmd'; Args = 'run dev'; Port = 5173; Url = 'http://localhost:5173/' }
    @{ Name = 'partner-web'; Dir = 'partner\frontend'; Exe = 'npm.cmd'; Args = 'run dev'; Port = 5373; Url = 'http://localhost:5373/' }
  )
}

function Read-State {
  if (-not (Test-Path $StateFile)) { return @() }
  try { return @(Get-Content $StateFile -Raw | ConvertFrom-Json) } catch { return @() }
}

# The recorded process, if it is still the one this script started (a PID can be reused).
function Get-LiveProcess($entry) {
  $process = Get-Process -Id $entry.Pid -ErrorAction SilentlyContinue
  if ($null -eq $process) { return $null }
  try {
    if ($process.StartTime.ToUniversalTime().Ticks -ne [long]$entry.StartTicks) { return $null }
  } catch { return $null }
  return $process
}

function Test-PortInUse([int]$port) {
  foreach ($address in @('127.0.0.1', '::1')) {
    $client = New-Object System.Net.Sockets.TcpClient
    try {
      $attempt = $client.BeginConnect($address, $port, $null, $null)
      if ($attempt.AsyncWaitHandle.WaitOne(300) -and $client.Connected) { return $true }
    } catch {
      # Nothing listening on this address.
    } finally {
      $client.Close()
    }
  }
  return $false
}

function Test-Answers([string]$url) {
  try {
    $response = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 5
    return $response.StatusCode -ge 200 -and $response.StatusCode -lt 500
  } catch {
    return $false
  }
}

function Assert-Setup {
  $problems = @()
  foreach ($service in @('professional', 'partner')) {
    if (-not (Test-Path (Join-Path $Root "$service\backend\.venv\Scripts\python.exe"))) {
      $problems += "$service\backend\.venv is missing: README step 3."
    }
    if (-not (Test-Path (Join-Path $Root "$service\backend\.env"))) {
      $problems += "$service\backend\.env is missing: README step 3."
    }
    if (-not (Test-Path (Join-Path $Root "$service\frontend\node_modules"))) {
      $problems += "$service\frontend\node_modules is missing: run npm ci there (README step 7)."
    }
  }
  if (-not (Get-Command npm.cmd -ErrorAction SilentlyContinue)) { $problems += 'npm is not on PATH: install Node.js 20 LTS or later.' }
  if ($problems.Count) {
    $problems | ForEach-Object { Write-Host "  - $_" -ForegroundColor Red }
    throw 'Finish the setup in README.md ("Running locally") first.'
  }
  # The web apps' public settings: created from the template when missing, never overwritten.
  foreach ($service in @('professional', 'partner')) {
    $local = Join-Path $Root "$service\frontend\.env.local"
    if (-not (Test-Path $local)) {
      Copy-Item (Join-Path $Root "$service\frontend\.env.example") $local
      Write-Host "Created $service\frontend\.env.local from .env.example."
    }
  }
}

function Stop-All {
  $state = Read-State
  if (-not $state.Count) {
    Write-Host 'Nothing to stop: no processes recorded in .dev\processes.json.'
    return
  }
  foreach ($entry in $state) {
    if (Get-LiveProcess $entry) {
      # /T ends the whole tree: uvicorn's reloader and worker, npm and Vite.
      & taskkill.exe /PID $entry.Pid /T /F 2>&1 | Out-Null
      Write-Host ("stopped  {0,-23} pid {1}" -f $entry.Name, $entry.Pid)
    } else {
      Write-Host ("gone     {0,-23} (already stopped)" -f $entry.Name)
    }
  }
  Remove-Item $StateFile -Force
}

function Show-Status {
  $state = Read-State
  $parts = Get-Parts
  foreach ($part in $parts) {
    $entry = $state | Where-Object { $_.Name -eq $part.Name } | Select-Object -First 1
    $running = $entry -and (Get-LiveProcess $entry)
    $answer = ''
    if ($part.Url) { $answer = if (Test-Answers $part.Url) { "answers at $($part.Url)" } else { 'not answering' } }
    $state_ = if ($running) { "running  pid $($entry.Pid)" } else { 'stopped' }
    Write-Host ("{0,-23} {1,-18} {2}" -f $part.Name, $state_, $answer)
  }
}

function Start-All {
  if ((Read-State | Where-Object { Get-LiveProcess $_ }).Count) {
    throw 'Already running (see "dev_start.ps1 status"). Run "dev_start.ps1 stop" or "restart" first.'
  }
  Assert-Setup
  $busy = Get-Parts | Where-Object { $_.Port -and (Test-PortInUse $_.Port) }
  if ($busy) {
    $busy | ForEach-Object { Write-Host "  - port $($_.Port) ($($_.Name)) is already in use" -ForegroundColor Red }
    throw 'Free those ports first; each app only accepts its fixed port.'
  }
  New-Item -ItemType Directory -Force $LogDir | Out-Null

  $state = @()
  foreach ($part in Get-Parts) {
    $out = Join-Path $LogDir "$($part.Name).out.log"
    $err = Join-Path $LogDir "$($part.Name).err.log"
    $process = Start-Process -FilePath $part.Exe -ArgumentList $part.Args -WorkingDirectory (Join-Path $Root $part.Dir) `
      -RedirectStandardOutput $out -RedirectStandardError $err -WindowStyle Hidden -PassThru
    $state += [pscustomobject]@{ Name = $part.Name; Pid = $process.Id; StartTicks = $process.StartTime.ToUniversalTime().Ticks }
    Write-Host ("started  {0,-23} pid {1}" -f $part.Name, $process.Id)
    # Saved after every start, so "stop" also cleans up after a start that failed half-way.
    ConvertTo-Json @($state) | Set-Content -Path $StateFile -Encoding utf8
  }

  $failed = @()
  foreach ($part in Get-Parts) {
    $entry = $state | Where-Object { $_.Name -eq $part.Name }
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $ok = $false
    while ((Get-Date) -lt $deadline) {
      if (-not (Get-LiveProcess $entry)) { break }
      if (-not $part.Url) { Start-Sleep -Seconds 3; $ok = [bool](Get-LiveProcess $entry); break }
      if (Test-Answers $part.Url) { $ok = $true; break }
      Start-Sleep -Milliseconds 700
    }
    if ($ok) {
      Write-Host ("ready    {0,-23} {1}" -f $part.Name, $(if ($part.Url) { $part.Url } else { 'running' })) -ForegroundColor Green
    } else {
      $failed += $part.Name
      Write-Host ("FAILED   {0,-23} last lines of .dev\logs\{0}.err.log:" -f $part.Name) -ForegroundColor Red
      Get-Content (Join-Path $LogDir "$($part.Name).err.log") -Tail 15 -ErrorAction SilentlyContinue | ForEach-Object { Write-Host "    $_" }
    }
  }
  if ($failed.Count) {
    throw "Not everything started ($($failed -join ', ')). Run 'dev_start.ps1 stop', fix the cause, and start again."
  }
  Write-Host ''
  Write-Host 'Professional: http://localhost:5173    Partner: http://localhost:5373'
  Write-Host 'Logs: .dev\logs    Stop: .\scripts\dev_start.ps1 stop'
}

switch ($Command) {
  'start' { Start-All }
  'stop' { Stop-All }
  'status' { Show-Status }
  'restart' { Stop-All; Start-All }
}
