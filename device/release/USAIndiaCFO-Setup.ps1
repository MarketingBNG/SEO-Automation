#Requires -Version 5.1
<#
.SYNOPSIS
  One-command USAIndiaCFO device setup for the intended employee's Windows account.
.DESCRIPTION
  For Codex accepting this single file without previous chat context:
  Run -Mode Check first. Run -Mode Install only after the admin has released the
  Windows Home rollout and confirmed the employee's dashboard consent. Use an
  interactive Windows PowerShell window under the employee's actual account.
  Let the employee enter their own work token or Device setup command and fresh
  SEB enrollment code directly into the prompts. Let the admin enter the SEB
  recovery password and approve any vendor installation prompt. Do not collect
  those values in chat or command arguments. Keep Seqrite enabled.

  On the Home pilot, Seqrite Behavior Detection quarantined the retired
  UIC-Watcher.ps1 and an earlier UIC-Launch.ps1. This installer uses
  ActivityWatch with UIC-ActivityWatch-Bridge.ps1. If a script is blocked
  or disappears, check Seqrite's detection history and capture the exact
  file, time, and detected checksum for review before retrying. The guide
  contains the incident details and verification steps.

  The installer provisions verified official SEB and ActivityWatch releases,
  configures app-only collection, and registers the per-user dashboard bridge
  and training tasks. Training is checked at sign-in and 09:00 IST. Save open
  work, restart once, then verify the task and a new "activity accepted" log
  entry at %LOCALAPPDATA%\UIC\training\ACTIVITYWATCH.log. Use only a
  disposable QA item to test SEB's Finished-to-desktop and recovery flows.

  Employees connect Zoho People and Zoho Projects once in the signed-in
  dashboard. Zoho writes are performed by the existing dashboard and scheduled
  server sync. Check a genuine prior working day for the expected single
  Projects entry. A device install does not verify the Zoho integrations.
.EXAMPLE
  powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File .\USAIndiaCFO-Setup.ps1 -Mode Install
#>
[CmdletBinding()]
param(
  [ValidateSet('Check', 'Install', 'Remove')]
  [string]$Mode = 'Check',
  [string]$InstallerPath,
  [string]$ActivityWatchInstallerPath
)

$ErrorActionPreference = 'Stop'
$dashboard = 'https://seo.usaindiacfo.us'
$bundleUrl = 'https://github.com/SafeExamBrowser/seb-win-refactoring/releases/download/v3.10.3/SEB_3.10.3.960_SetupBundle.exe'
$bundleHash = '716B25F77ADA22BFFDD223E147C3F21042D130C006347E35BD9BE2C91E51730B'
$testedSebVersion = '3.10.3.960'
$activityWatchUrl = 'https://github.com/ActivityWatch/activitywatch/releases/download/v0.14.3/activitywatch-v0.14.3-windows-x86_64-setup.exe'
$activityWatchHash = '6CE8B3D3B0E5A143047D56489C56423D234B90A41681F3A42724902A7E9653C1'

# These payloads come from the VM pilot. Setup writes them into the current Windows user's profile.
$launcherSource = @'
# USAIndiaCFO SEB launcher (Windows, PowerShell 5+). DEVICE-SIDE; NOT tested on Windows here.
#
# One-time enrollment + silent re-auth for Safe Exam Browser, with the dashboard gate run BEFORE launch:
#   - First run: no stored credential -> you enter the one-time code (from /seb-code in the regular
#     browser). The launcher links this employee to THIS Windows user, stores a revocable credential
#     securely (DPAPI, per Windows user), then runs the gate.
#   - Later runs/reboots: the launcher silently exchanges the stored credential for the gate result. No
#     code is asked again unless the enrollment is REVOKED, the credential is wrong, or a different
#     Windows user signs in (server returns 401 enroll_required; DPAPI + server binding both enforce this).
#
# The gate decides whether SEB opens:
#   - status "pending"  -> training is due now (at/after 09:00 IST, not yet done): a fresh single-use code
#     is returned; the launcher opens SEB AT THAT CODE, inside the SEB config (never the default browser).
#   - any other status ("before-window" before 09:00 IST, "no-training" on Sunday / a day with none,
#     "done" after completion, "not-ready", "error") -> SEB is NOT opened; the normal desktop stays usable.
#
# Transient failures (timeout, offline, server 5xx) KEEP the DPAPI enrollment and simply do not launch;
# the credential is cleared ONLY on an explicit 401 enroll_required (revoked / rejected). The durable
# credential never appears in a URL. SEB only ever receives a fresh single-use code in the config's start
# URL fragment (/seb#code=...), which the page redeems and scrubs.
#
# Run at logon (per user). Configure $Dashboard and $SebExe/$SebConfig for your SEB setup. The base
# $SebConfig MUST contain the placeholder __START_URL__ as its startURL (see device/uic.seb); the launcher
# copies the config to a temp file and substitutes the real /seb#code=... URL before launching SEB.

param(
  [string]$Dashboard = $env:UIC_DASHBOARD,
  [string]$SebExe = "$env:ProgramFiles\SafeExamBrowser\Application\SafeExamBrowser.exe",
  [string]$SebConfig = "$env:ProgramData\UIC\uic.seb",  # base SEB config; startURL must be __START_URL__
  [switch]$Automatic,
  [string]$PilotLog,
  [switch]$MeasureSeb
)
if (-not $Dashboard) { Write-Error "Set -Dashboard (or UIC_DASHBOARD)."; exit 1 }
$Dashboard = $Dashboard.TrimEnd('/')
$elapsed = [Diagnostics.Stopwatch]::StartNew()

function Write-PilotLog([string]$event) {
  if ($PilotLog) {
    try {
      $line = '{0:O} +{1}ms {2}' -f [DateTime]::UtcNow, $elapsed.ElapsedMilliseconds, $event
      [IO.File]::AppendAllText($PilotLog, $line + [Environment]::NewLine)
    } catch { Write-Verbose 'Pilot log is unavailable.' }
  }
}

Write-PilotLog 'launcher start'
Add-Type -AssemblyName System.Security

# The current Windows user's SID: the enrollment is bound to it, so the credential is useless to anyone
# else even if copied.
$sid = ([System.Security.Principal.WindowsIdentity]::GetCurrent()).User.Value

$store = Join-Path $env:LOCALAPPDATA 'UIC\seb-enroll.bin'
New-Item -ItemType Directory -Force -Path (Split-Path $store) | Out-Null

function Save-Cred($obj) {
  $bytes = [Text.Encoding]::UTF8.GetBytes(($obj | ConvertTo-Json -Compress))
  $prot = [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser') # DPAPI, per Windows user
  [IO.File]::WriteAllText($store, [Convert]::ToBase64String($prot))
}
function Load-Cred {
  if (-not (Test-Path $store)) { return $null }
  try {
    $prot = [Convert]::FromBase64String([IO.File]::ReadAllText($store))
    $bytes = [Security.Cryptography.ProtectedData]::Unprotect($prot, $null, 'CurrentUser')
    return ([Text.Encoding]::UTF8.GetString($bytes) | ConvertFrom-Json)
  } catch { return $null }
}
function Clear-Cred { Remove-Item $store -ErrorAction SilentlyContinue }

function Wait-InteractiveDesktop {
  # The task runs in the signed-in user's session. Wait for that session's
  # Explorer shell to settle before handing the launch to SEB.
  $sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
  if ($sessionId -eq 0) { return $false }
  $wait = [Diagnostics.Stopwatch]::StartNew()
  $readySince = $null
  do {
    $shell = Get-Process -Name explorer -ErrorAction SilentlyContinue |
      Where-Object SessionId -eq $sessionId |
      Select-Object -First 1
    if ($shell) {
      if ($null -eq $readySince) { $readySince = $wait.ElapsedMilliseconds }
      if (($wait.ElapsedMilliseconds - $readySince) -ge 2000) { return $true }
    } else {
      $readySince = $null
    }
    Start-Sleep -Milliseconds 250
  } while ($wait.ElapsedMilliseconds -lt 12000)
  return $false
}

function Measure-SebProcesses([int]$sessionId) {
  $previousCpu = @{}
  $previousTime = $elapsed.Elapsed.TotalSeconds
  for ($sample = 0; $sample -lt 45; $sample++) {
    Start-Sleep -Seconds 2
    $currentTime = $elapsed.Elapsed.TotalSeconds
    $currentCpu = @{}
    $usedCpu = 0.0
    $workingSet = 0L
    $privateBytes = 0L
    $processes = @(Get-Process -Name 'SafeExamBrowser*' -ErrorAction SilentlyContinue)
    foreach ($process in $processes) {
      try {
        if ($process.SessionId -ne $sessionId) { continue }
        $currentCpu[$process.Id] = $process.TotalProcessorTime.TotalSeconds
        if ($previousCpu.ContainsKey($process.Id)) {
          $usedCpu += [Math]::Max(0, $currentCpu[$process.Id] - $previousCpu[$process.Id])
        } elseif ($sample -gt 0) {
          $usedCpu += $currentCpu[$process.Id]
        }
        $workingSet += $process.WorkingSet64
        $privateBytes += $process.PrivateMemorySize64
      } catch { Write-Verbose 'SEB process exited during sampling.' }
    }
    if ($sample -gt 0 -and $currentTime -gt $previousTime) {
      $cpuPercent = 100 * $usedCpu / (($currentTime - $previousTime) * [Environment]::ProcessorCount)
      Write-PilotLog ('seb sample processes={0} guest-cpu-pct={1:F2} working-mib={2:F1} private-mib={3:F1}' -f $currentCpu.Count, $cpuPercent, ($workingSet / 1MB), ($privateBytes / 1MB))
    }
    $previousCpu = $currentCpu
    $previousTime = $currentTime
  }
}

# Open SEB AT a fresh single-use code, inside the SEB config. The URL is NEVER handed to the default
# browser: it is written into a temp copy of the SEB config (startURL) and SEB is launched on that config,
# so the page only ever opens inside the locked-down browser.
function Open-Seb([string]$code) {
  if (-not (Test-Path $SebExe)) { Write-Error "SafeExamBrowser.exe not found at $SebExe."; return $false }
  if (-not (Test-Path $SebConfig)) { Write-Error "SEB config not found at $SebConfig."; return $false }
  $sessionId = (Get-Process -Id $PID).SessionId
  $runningSeb = Get-Process -Name SafeExamBrowser, SafeExamBrowser.Client -ErrorAction SilentlyContinue |
    Where-Object SessionId -eq $sessionId
  if ($runningSeb) {
    Write-PilotLog 'SEB already running'
    Write-Host 'Safe Exam Browser is already running in this Windows session.'
    return $true
  }
  $url = "$Dashboard/seb#code=$([Uri]::EscapeDataString($code))"
  $raw = [IO.File]::ReadAllText($SebConfig)
  if ($raw -notmatch '__START_URL__') { Write-Error "SEB config has no __START_URL__ placeholder; cannot inject the start URL safely."; return $false }
  Get-ChildItem -LiteralPath $PSScriptRoot -File -Filter "uic-seb-*.seb" -ErrorAction SilentlyContinue | Where-Object LastWriteTimeUtc -LT ([DateTime]::UtcNow.AddMinutes(-10)) | Remove-Item -ErrorAction SilentlyContinue
  $tmp = Join-Path $PSScriptRoot ("uic-seb-" + [Guid]::NewGuid().ToString('N') + ".seb")
  try {
    if ($Automatic) {
      Write-PilotLog 'waiting for interactive desktop'
      if (-not (Wait-InteractiveDesktop)) {
        Write-PilotLog 'interactive desktop readiness timed out'
        return $false
      }
      Write-PilotLog 'interactive desktop ready'
    }
    [IO.File]::WriteAllText($tmp, $raw.Replace('__START_URL__', $url))
    Write-PilotLog 'starting SEB process'
    Start-Process -FilePath $SebExe -ArgumentList ('"{0}"' -f $tmp) -ErrorAction Stop | Out-Null
    Write-PilotLog 'SEB process dispatched'
    if ($MeasureSeb -and $PilotLog) { Measure-SebProcesses $sessionId }
    return $true
  } catch {
    Write-PilotLog 'SEB dispatch failed'
    Write-Error "Could not launch SEB: $($_.Exception.Message)"
    return $false
  }
  # SEB reads the config at launch; the per-user file can be cleaned up by a later launch after the code expires.
}

# Exchange the stored credential for the gate decision. Returns a structured result the caller branches on,
# distinguishing a genuine rejection (401 enroll_required -> re-enroll) from a transient failure (timeout,
# offline, 5xx -> keep the credential, do not launch).
#   @{ outcome = 'ok';       status; launch; code }  -> server answered; launch/code per the gate
#   @{ outcome = 'rejected' }                         -> 401 enroll_required: clear + re-enroll
#   @{ outcome = 'transient'; message }               -> no answer / server error: keep credential, no launch
function Enroll-Exchange($cred) {
  $body = @{ id = $cred.id; secret = $cred.secret; windowsUser = $sid } | ConvertTo-Json -Compress
  try {
    Write-PilotLog 'gate request'
    $r = Invoke-RestMethod -Uri "$Dashboard/api/seb/enroll-session" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
    $knownStatuses = 'pending','done','before-window','no-training','not-ready','error','not-tracked'
    $status = if ($r.status -in $knownStatuses) { $r.status } else { 'unexpected' }
    Write-PilotLog "gate response $status"
    return @{ outcome = 'ok'; status = $r.status; launch = [bool]$r.launch; code = $r.code }
  } catch {
    # Only an HTTP 401 means the enrollment is no longer valid. A timeout / DNS / connection failure has no
    # Response; a 5xx has one but is not 401. Keep the credential in both those cases.
    $resp = $_.Exception.Response
    $statusCode = $null
    if ($resp -and ($resp.PSObject.Properties.Name -contains 'StatusCode')) {
      try { $statusCode = [int]$resp.StatusCode } catch { $statusCode = $null }
    }
    if ($statusCode -eq 401) { Write-PilotLog 'gate rejected enrollment'; return @{ outcome = 'rejected' } }
    Write-PilotLog 'gate request failed'
    return @{ outcome = 'transient'; message = $_.Exception.Message }
  }
}

# Act on the exchange result: launch SEB only when the gate says pending; otherwise leave the desktop.
function Invoke-GateResult($res) {
  switch ($res.outcome) {
    'ok' {
      if ($res.status -eq 'pending' -and $res.launch -and $res.code) {
        if (Open-Seb $res.code) { exit 0 } else { exit 1 }
      }
      # before-window / no-training / done / not-ready / error: desktop stays available, no launch.
      Write-Host "No training to open now (status: $($res.status)). Desktop stays available."
      exit 0
    }
    'transient' {
      # Timeout / offline / server error: keep the enrollment, do not launch, try again next logon.
      Write-Warning "Could not reach the dashboard ($($res.message)). Keeping enrollment; try again later."
      exit 0
    }
    'rejected' { return } # handled by the caller (clear + re-enroll)
  }
}

$cred = Load-Cred
if ($cred) {
  $res = Enroll-Exchange $cred
  if ($res.outcome -ne 'rejected') { Invoke-GateResult $res }  # ok/transient exit inside
  Clear-Cred  # explicit 401 enroll_required only -> fall through to first-time enrollment
}

if ($Automatic) {
  Write-PilotLog 'automatic launch requires enrollment'
  Write-Warning 'SEB enrollment is required. Run the launcher manually to link this Windows account.'
  exit 2
}

# First time (or re-enrol): get the one-time code from /seb-code in the regular browser and enter it.
$code = Read-Host 'Enter the one-time code from the SEB code page'
try {
  $body = @{ code = $code.Trim(); windowsUser = $sid; enroll = $true; label = $env:COMPUTERNAME } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Uri "$Dashboard/api/seb/check-in" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
  if (-not $r.enrollment) { Write-Error 'Enrollment was not returned. Check the code and try again.'; exit 1 }
  Save-Cred @{ id = $r.enrollment.id; secret = $r.enrollment.secret }
} catch { Write-Error "Check In failed: $($_.Exception.Message)"; exit 1 }

$res = Enroll-Exchange (Load-Cred)
if ($res.outcome -eq 'rejected') { Clear-Cred; Write-Error 'Enrollment was rejected right after linking. Try again.'; exit 1 }
Invoke-GateResult $res
'@
$watcherSource = @'
#Requires -Version 5.1
[CmdletBinding()]
param(
  [switch]$Check,
  [switch]$Once
)

$ErrorActionPreference = 'Stop'
$localApi = 'http://127.0.0.1:5600/api/0'
$reportUrl = 'https://seo.usaindiacfo.us/api/worklog/report'
$trainingDir = Join-Path $env:LOCALAPPDATA 'UIC\training'
$tokenPath = Join-Path $trainingDir 'watcher-token.bin'
$logPath = Join-Path $trainingDir 'ACTIVITYWATCH.log'
$lagSeconds = 30

function Write-BridgeStatus([string]$message) {
  if ($Check) { Write-Host $message; return }
  if ((Test-Path -LiteralPath $logPath) -and (Get-Item -LiteralPath $logPath).Length -gt 128KB) {
    [IO.File]::WriteAllText($logPath, '')
  }
  [IO.File]::AppendAllText($logPath, ('{0:o} {1}{2}' -f [DateTimeOffset]::UtcNow, $message, [Environment]::NewLine))
}

function Get-LocalWindows {
  $buckets = Invoke-RestMethod -Uri "$localApi/buckets/" -TimeoutSec 10 -MaximumRedirection 0
  $window = $buckets.PSObject.Properties["aw-watcher-window_$env:COMPUTERNAME"].Value
  $afk = $buckets.PSObject.Properties["aw-watcher-afk_$env:COMPUTERNAME"].Value
  if (!$window -or $window.type -ne 'currentwindow' -or !$afk -or $afk.type -ne 'afkstatus') {
    throw 'Local foreground and idle buckets are not ready.'
  }
  return @{ Window = $window.id; Afk = $afk.id }
}

function Get-LocalEvents([string]$bucket, [DateTimeOffset]$from, [DateTimeOffset]$until) {
  $id = [Uri]::EscapeDataString($bucket)
  $start = [Uri]::EscapeDataString($from.ToString('o'))
  $end = [Uri]::EscapeDataString($until.ToString('o'))
  $events = Invoke-RestMethod -Uri "$localApi/buckets/$id/events?start=$start&end=$end" -TimeoutSec 10 -MaximumRedirection 0
  foreach ($event in $events) {
    if (!$event.timestamp -or [double]$event.duration -le 0) { continue }
    $startTime = [DateTimeOffset]$event.timestamp
    $endTime = $startTime.AddSeconds([double]$event.duration)
    if ($startTime -lt $from) { $startTime = $from }
    if ($endTime -gt $until) { $endTime = $until }
    if ($endTime -gt $startTime) {
      [pscustomobject]@{ Start = $startTime; End = $endTime; Data = $event.data }
    }
  }
}

function Get-UsageReport($buckets, [DateTimeOffset]$from, [DateTimeOffset]$until) {
  $windows = @(Get-LocalEvents $buckets.Window $from $until)
  if ($windows | Where-Object { $_.Data.url -or ($_.Data.title -and $_.Data.title -ne 'excluded') } | Select-Object -First 1) {
    throw 'The local window watcher is retaining window titles or URLs.'
  }
  $active = @(Get-LocalEvents $buckets.Afk $from $until | Where-Object { $_.Data.status -eq 'not-afk' })
  $totals = @{}
  foreach ($window in $windows) {
    $app = [string]$window.Data.app
    if (!$app -or $app -eq 'unknown') { continue }
    foreach ($interval in $active) {
      $start = if ($window.Start -gt $interval.Start) { $window.Start } else { $interval.Start }
      $end = if ($window.End -lt $interval.End) { $window.End } else { $interval.End }
      if ($end -gt $start) { $totals[$app] += ($end - $start).TotalMilliseconds }
    }
  }
  foreach ($app in $totals.Keys) {
    $ms = [long][Math]::Floor($totals[$app])
    if ($ms -gt 0) { @{ app = $app; ms = $ms } }
  }
}

if ($Check) {
  $buckets = Get-LocalWindows
  $until = [DateTimeOffset]::UtcNow
  $apps = @(Get-UsageReport $buckets $until.AddMinutes(-2) $until)
  Write-BridgeStatus "Local app and idle buckets verified. Active app buckets in last two minutes: $($apps.Count). No report sent."
  return
}

Add-Type -AssemblyName System.Security
$tokenBytes = [Security.Cryptography.ProtectedData]::Unprotect([IO.File]::ReadAllBytes($tokenPath), $null, 'CurrentUser')
try { $token = [Text.Encoding]::UTF8.GetString($tokenBytes) }
finally { [Array]::Clear($tokenBytes, 0, $tokenBytes.Length) }

# Use only activity recorded after this bridge starts. The dashboard dates reports on receipt.
$cursor = [DateTimeOffset]::UtcNow
$stopAt = $cursor.AddMinutes(3)
$ist = [TimeZoneInfo]::FindSystemTimeZoneById('India Standard Time')
Write-BridgeStatus 'ActivityWatch bridge started'

do {
  Start-Sleep -Seconds 15
  $now = [DateTimeOffset]::UtcNow
  $end = $now.AddSeconds(-$lagSeconds)
  if (($end - $cursor).TotalSeconds -ge 60) {
    $from = $cursor
    $cursor = $end
    # Avoid backfill after sleep and avoid attributing activity to the wrong IST day.
    if (($end - $from).TotalMinutes -gt 2) { $from = $end.AddMinutes(-1) }
    $today = [TimeZoneInfo]::ConvertTime($now, $ist)
    $midnight = [DateTimeOffset]::new($today.Date, $today.Offset)
    if ($from -lt $midnight) { $from = $midnight }
    if ($end -le $from) { continue }

    try {
      $buckets = Get-LocalWindows
      $apps = @(Get-UsageReport $buckets $from $end)
      if (!$apps.Count) { Write-BridgeStatus 'No active app time in this interval'; continue }
    } catch {
      Write-BridgeStatus 'Local ActivityWatch read or privacy check failed'
      continue
    }

    try {
      $body = @{ apps = $apps } | ConvertTo-Json -Depth 4 -Compress
      $receipt = Invoke-RestMethod -Uri $reportUrl -Headers @{ 'x-work-token' = $token } -ContentType 'application/json' -Method Post -Body $body -TimeoutSec 20 -MaximumRedirection 0
      if ($receipt.ok -eq $true) {
        Write-BridgeStatus 'activity accepted'
        if ($Once) { return }
      } else { Write-BridgeStatus 'Dashboard did not confirm receipt' }
    } catch {
      # The API does not accept an idempotency key. Do not resend uncertain writes.
      Write-BridgeStatus 'Dashboard activity report failed'
    }
  }
} while (!$Once -or [DateTimeOffset]::UtcNow -lt $stopAt)

throw 'No live dashboard acknowledgment was verified.'
'@


$profileSource = @'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
<key>sebConfigPurpose</key><integer>0</integer>
<key>allowVirtualMachine</key><true/>
<key>allowedDisplaysIgnoreFailure</key><true/>
<key>startURL</key><string>__START_URL__</string>
<key>quitURL</key><string>https://seo.usaindiacfo.us/seb/quit</string>
<key>quitURLConfirm</key><false/>
<key>allowQuit</key><true/>
<key>hashedQuitPassword</key><string>__ADMIN_QUIT_HASH__</string>
<key>createNewDesktop</key><true/>
<key>killExplorerShell</key><false/>
<key>enableAltTab</key><false/>
<key>enableCtrlEsc</key><false/>
<key>enableStartMenu</key><false/>
<key>browserViewMode</key><integer>1</integer>
</dict>
</plist>
'@


$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$sid = $identity.User.Value
$sebTask = "UIC SEB Training $sid"
$watcherTask = "UIC ActivityWatch Bridge $sid"
$legacyWatcherTask = "UIC Activity Watcher $sid"
$taskNames = @($sebTask, $watcherTask)
$base = Join-Path $env:LOCALAPPDATA 'UIC'
$installDir = Join-Path $base 'training'
$credentialPath = Join-Path $base 'seb-enroll.bin'
$launcher = Join-Path $installDir 'UIC-Launch.ps1'
$watcher = Join-Path $installDir 'UIC-ActivityWatch-Bridge.ps1'
$profile = Join-Path $installDir 'UIC-Training.seb'
$tokenPath = Join-Path $installDir 'watcher-token.bin'
$shell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$sebExe = Join-Path $env:ProgramFiles 'SafeExamBrowser\Application\SafeExamBrowser.exe'
$watcherLog = Join-Path $installDir 'ACTIVITYWATCH.log'
$launcherLog = Join-Path $installDir 'SEB-STARTUP.log'

function New-TaskXml([string]$description, [string]$arguments, [bool]$daily) {
  $calendar = ''
  if ($daily) {
    $ist = [TimeZoneInfo]::FindSystemTimeZoneById('India Standard Time')
    $now = [TimeZoneInfo]::ConvertTime([DateTimeOffset]::UtcNow, $ist)
    $next = $now.Date.AddHours(9)
    if ($next -le $now.DateTime) { $next = $next.AddDays(1) }
    $boundary = [DateTimeOffset]::new($next, $ist.GetUtcOffset($next)).ToString(
      "yyyy-MM-dd'T'HH:mm:sszzz", [Globalization.CultureInfo]::InvariantCulture)
    $calendar = "<CalendarTrigger><StartBoundary>$boundary</StartBoundary><Enabled>true</Enabled><ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay></CalendarTrigger>"
  }
  $encodedArgs = [Security.SecurityElement]::Escape($arguments)
  $encodedShell = [Security.SecurityElement]::Escape($shell)
  $limit = if ($daily) { 'PT4M' } else { 'PT0S' }
  return @"
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>$description</Description></RegistrationInfo>
  <Triggers>
    <LogonTrigger><Enabled>true</Enabled><UserId>$sid</UserId></LogonTrigger>
    $calendar
  </Triggers>
  <Principals><Principal id="Employee">
    <UserId>$sid</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel>
  </Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>$limit</ExecutionTimeLimit>
  </Settings>
  <Actions Context="Employee"><Exec><Command>$encodedShell</Command><Arguments>$encodedArgs</Arguments></Exec></Actions>
</Task>
"@
}

function Assert-FileChecksum([string]$path, [string]$expectedHash) {
  $stream = [IO.File]::OpenRead($path)
  $sha = [Security.Cryptography.SHA256]::Create()
  try {
    $actualHash = [BitConverter]::ToString($sha.ComputeHash($stream)).Replace('-', '')
  } finally {
    $sha.Dispose()
    $stream.Dispose()
  }
  if ($actualHash -cne $expectedHash) { throw 'An installer did not match the official SHA-256 checksum.' }
}

function Assert-VendorBundle([string]$path) {
  Assert-FileChecksum $path $bundleHash
  $securityModule = Join-Path $PSHOME 'Modules\Microsoft.PowerShell.Security\Microsoft.PowerShell.Security.psd1'
  Import-Module -Name $securityModule -ErrorAction Stop
  $signature = Microsoft.PowerShell.Security\Get-AuthenticodeSignature -LiteralPath $path
  if ($signature.Status -ne 'Valid') { throw "The SEB installer signature is $($signature.Status)." }
}

function Ensure-ActivityWatch {
  $appDir = Join-Path $env:LOCALAPPDATA 'Programs\ActivityWatch'
  $app = Join-Path $appDir 'aw-qt.exe'
  $configDir = Join-Path $env:LOCALAPPDATA 'activitywatch\activitywatch\aw-watcher-window'
  $config = Join-Path $configDir 'aw-watcher-window.toml'
  if (!(Test-Path -LiteralPath $config)) {
    if (Get-Process -Name 'aw-qt','aw-watcher-window' -ErrorAction SilentlyContinue) {
      throw 'ActivityWatch is already running with an unknown configuration. Review its privacy settings before setup.'
    }
    [void][IO.Directory]::CreateDirectory($configDir)
    [IO.File]::WriteAllLines($config, @('[aw-watcher-window]', 'exclude_title = true', 'poll_time = 5.0'))
  }
  if (!(Select-String -LiteralPath $config -Pattern '^\s*exclude_title\s*=\s*true\s*$' -Quiet)) {
    throw 'ActivityWatch must be configured to exclude window titles before connecting it to the dashboard.'
  }

  if (!(Test-Path -LiteralPath $app -PathType Leaf)) {
    $download = $null
    try {
      if ($ActivityWatchInstallerPath) {
        $vendor = (Resolve-Path -LiteralPath $ActivityWatchInstallerPath).ProviderPath
      } else {
        $download = Join-Path $env:TEMP ('UIC-ActivityWatch-' + [Guid]::NewGuid().ToString('N') + '.exe')
        Write-Host 'Downloading the official ActivityWatch installer.'
        $ProgressPreference = 'SilentlyContinue'
        Invoke-WebRequest -UseBasicParsing -Uri $activityWatchUrl -OutFile $download -TimeoutSec 600
        $vendor = $download
      }
      Assert-FileChecksum $vendor $activityWatchHash
      $vendorArgs = '/VERYSILENT /NORESTART /CURRENTUSER /TASKS=StartMenuEntry /DIR="{0}"' -f $appDir
      $install = Start-Process -FilePath $vendor -ArgumentList $vendorArgs -WindowStyle Hidden -Wait -PassThru
      if ($install.ExitCode -ne 0) { throw "ActivityWatch installer exited with code $($install.ExitCode)." }
    } finally {
      if ($download) { Remove-Item -LiteralPath $download -ErrorAction SilentlyContinue }
    }
  }
  if (!(Test-Path -LiteralPath $app -PathType Leaf)) { throw 'The ActivityWatch tray app was not found after setup.' }
  $startup = [Environment]::GetFolderPath('Startup')
  $shortcut = Join-Path $startup 'ActivityWatch.lnk'
  $runKey = Get-ItemProperty -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run' -Name ActivityWatch -ErrorAction SilentlyContinue
  if (!(Test-Path -LiteralPath $shortcut -PathType Leaf) -and !$runKey.ActivityWatch) {
    throw 'ActivityWatch start-at-login is disabled. Enable Start at login in its tray menu and rerun setup.'
  }
  if (!(Get-Process -Name 'aw-qt' -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $app -WorkingDirectory $appDir -WindowStyle Hidden
  }
  $deadline = [DateTime]::UtcNow.AddSeconds(60)
  do {
    try {
      $health = Invoke-RestMethod -Uri 'http://127.0.0.1:5600/api/0/info' -TimeoutSec 3 -MaximumRedirection 0
      $buckets = Invoke-RestMethod -Uri 'http://127.0.0.1:5600/api/0/buckets/' -TimeoutSec 3 -MaximumRedirection 0
      if ($health.version -eq 'v0.14.3' -and
          $buckets.PSObject.Properties["aw-watcher-window_$env:COMPUTERNAME"].Value.type -eq 'currentwindow' -and
          $buckets.PSObject.Properties["aw-watcher-afk_$env:COMPUTERNAME"].Value.type -eq 'afkstatus') {
        $listeners = Get-NetTCPConnection -LocalPort 5600 -State Listen
        if ($listeners | Where-Object { $_.LocalAddress -notin @('127.0.0.1', '::1') }) {
          throw 'ActivityWatch is exposed to the network. Set its server to loopback before setup.'
        }
        return
      }
    } catch {
      if ($_.Exception.Message -like 'ActivityWatch is exposed*') { throw }
    }
    Start-Sleep -Seconds 2
  } while ([DateTime]::UtcNow -lt $deadline)
  throw 'ActivityWatch app and idle buckets did not start on the local API.'
}

function Assert-Script([string]$source) {
  $tokens = $null
  $errors = $null
  [void][Management.Automation.Language.Parser]::ParseInput($source, [ref]$tokens, [ref]$errors)
  if ($errors.Count) { throw $errors[0].Message }
}

function Read-PrivateText([string]$prompt) {
  $secure = Read-Host $prompt -AsSecureString
  $pointer = [Runtime.InteropServices.Marshal]::SecureStringToGlobalAllocUnicode($secure)
  try { [Runtime.InteropServices.Marshal]::PtrToStringUni($pointer) }
  finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeGlobalAllocUnicode($pointer)
    $secure.Dispose()
  }
}

function Protect-Text([string]$value) {
  $bytes = [Text.Encoding]::UTF8.GetBytes($value)
  try { [Security.Cryptography.ProtectedData]::Protect($bytes, $null, 'CurrentUser') }
  finally { [Array]::Clear($bytes, 0, $bytes.Length) }
}

function Get-WorkTokenValue([string]$inputText) {
  $candidate = $inputText.Trim()
  if ($candidate -match '\A[0-9a-fA-F]{48}\z') { return $candidate.ToLowerInvariant() }
  $pattern = '(?i)(?:^|\s)-Token\s+(?:"([0-9a-f]{48})"|''([0-9a-f]{48})''|([0-9a-f]{48})(?=\s|$))'
  $matchesFound = [regex]::Matches($candidate, $pattern)
  if ($matchesFound.Count -eq 1) {
    foreach ($group in $matchesFound[0].Groups | Select-Object -Skip 1) {
      if ($group.Success) { return $group.Value.ToLowerInvariant() }
    }
  }
}

function Read-ProtectedWorkToken {
  while ($true) {
    $inputText = Read-PrivateText 'Paste the employee work token or the full Device setup command (blank cancels)'
    if ([string]::IsNullOrWhiteSpace($inputText)) { throw 'Setup cancelled before any changes.' }
    try { $workToken = Get-WorkTokenValue $inputText }
    finally { $inputText = $null }
    if (!$workToken) {
      Write-Warning 'No single 48-character work token was found. Copy the token or the complete command from Device setup.'
      continue
    }
    try {
      try {
        $gate = Invoke-RestMethod -Uri "$dashboard/api/worklog/gate" -Headers @{ 'x-work-token' = $workToken } -MaximumRedirection 0 -TimeoutSec 20
      } catch {
        $httpStatus = $_.Exception.Response.StatusCode
        if ($httpStatus -in @(401, 403)) {
          Write-Warning 'The dashboard rejected this work token. Ask the dashboard admin for the current token for this employee.'
          continue
        }
        throw 'The dashboard work-token check could not complete. Check the connection and retry setup.'
      }
      switch ($gate.status) {
        { $_ -in @('pending', 'done', 'before-window', 'no-training', 'not-ready') } {
          return ,([byte[]](Protect-Text $workToken))
        }
        'invalid-token' { Write-Warning 'Dashboard status: invalid-token. Ask the dashboard admin for the current token for this employee.' }
        'not-tracked' { Write-Warning 'Dashboard status: not-tracked. Select a tracked employee account in Device setup.' }
        'error' { throw 'Dashboard status: error. The dashboard could not check training. Retry when it is available.' }
        default { throw 'The dashboard did not return a recognized work-token status. Ask the dashboard team to check /api/worklog/gate.' }
      }
    } finally { $workToken = $null }
  }
}

function Ensure-Seb {
  if (Test-Path -LiteralPath $sebExe -PathType Leaf) {
    $version = (Get-Item -LiteralPath $sebExe).VersionInfo.FileVersion
    if ($version -ne $testedSebVersion) { throw "SEB $version is installed. This package was prepared for $testedSebVersion." }
    return
  }

  $download = $null
  try {
    if ($InstallerPath) {
      $bundle = (Resolve-Path -LiteralPath $InstallerPath).ProviderPath
    } else {
      $download = Join-Path $env:TEMP ("UIC-SEB-" + [Guid]::NewGuid().ToString('N') + '.exe')
      Write-Host 'Downloading the official Safe Exam Browser installer.'
      $ProgressPreference = 'SilentlyContinue'
      Invoke-WebRequest -UseBasicParsing -Uri $bundleUrl -OutFile $download -TimeoutSec 600
      $bundle = $download
    }
    Assert-VendorBundle $bundle
    $process = Start-Process -FilePath $bundle -Verb RunAs -ArgumentList '/quiet /norestart' -Wait -PassThru
    if ($process.ExitCode -in @(1641, 3010)) { throw 'SEB requires a restart. Restart Windows and rerun this setup.' }
    if ($process.ExitCode -ne 0) { throw "SEB installer exited with code $($process.ExitCode)." }
    if (!(Test-Path -LiteralPath $sebExe -PathType Leaf)) { throw 'SEB installation finished but its executable was not found.' }
    if ((Get-Item -LiteralPath $sebExe).VersionInfo.FileVersion -ne $testedSebVersion) {
      throw 'The installed SEB executable does not match the tested version.'
    }
  } finally {
    if ($download -and (Test-Path -LiteralPath $download)) {
      Remove-Item -LiteralPath $download -ErrorAction SilentlyContinue
    }
  }
}

$common = '-NoProfile -NonInteractive -WindowStyle Hidden -ExecutionPolicy RemoteSigned'
$launcherArgs = "$common -File `"$launcher`" -Dashboard `"$dashboard`" -SebConfig `"$profile`" -Automatic -PilotLog `"$launcherLog`""
$watcherArgs = "$common -File `"$watcher`""
$sebXml = New-TaskXml 'USAIndiaCFO training at sign-in and at 09:00 IST.' $launcherArgs $true
$watcherXml = New-TaskXml 'USAIndiaCFO ActivityWatch dashboard bridge at sign-in.' $watcherArgs $false

if ($Mode -eq 'Check') {
  Assert-Script $launcherSource
  Assert-Script $watcherSource
  [xml]$parsedProfile = $profileSource
  [xml]$parsedSeb = $sebXml
  [xml]$parsedWatcher = $watcherXml
  if ($parsedProfile.plist.dict.string -notcontains "$dashboard/seb/quit" -or
      $parsedProfile.plist.dict.string -notcontains '__ADMIN_QUIT_HASH__') { throw 'The kiosk profile did not pass its configuration check.' }
  if ($parsedSeb.Task.Triggers.LogonTrigger.UserId -ne $sid -or
      $parsedWatcher.Task.Triggers.LogonTrigger.UserId -ne $sid -or
      $parsedSeb.Task.Triggers.CalendarTrigger.StartBoundary -notmatch 'T09:00:00\+05:30$' -or
      $parsedWatcher.Task.Triggers.CalendarTrigger) { throw 'The scheduled task checks failed.' }
  $edition = Get-ItemPropertyValue 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -Name EditionID
  Write-Host "Windows edition: $edition"
  Write-Host 'PASS: Launcher and watcher syntax, quit profile, and per-user task definitions.'
  if ($InstallerPath) {
    Assert-VendorBundle $InstallerPath
    Write-Host 'PASS: Official SEB installer checksum and signature.'
  }
  if ($ActivityWatchInstallerPath) {
    Assert-FileChecksum $ActivityWatchInstallerPath $activityWatchHash
    Write-Host 'PASS: Official ActivityWatch installer checksum.'
  }
  if (Test-Path -LiteralPath $sebExe -PathType Leaf) {
    Write-Host "Installed SEB: $((Get-Item -LiteralPath $sebExe).VersionInfo.FileVersion)"
  } else { Write-Host 'SEB is not installed yet.' }
  Write-Host 'Check mode finished. No software, tasks or credentials were installed.'
  return
}

foreach ($command in @('Get-ScheduledTask', 'Register-ScheduledTask', 'Unregister-ScheduledTask', 'Start-ScheduledTask', 'Stop-ScheduledTask')) {
  [void](Get-Command $command)
}

if ($Mode -eq 'Remove') {
  foreach ($name in $taskNames) {
    if (Get-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue) {
      Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
      Unregister-ScheduledTask -TaskName $name -Confirm:$false
    }
  }
  Write-Host 'Scheduled training and the dashboard reporting bridge were removed for this Windows user.'
  Write-Host 'To stop ActivityWatch local collection, quit it and turn off Start at login in its tray menu.'
  return
}

if ([Diagnostics.Process]::GetCurrentProcess().SessionId -eq 0 -or $identity.Name -match '\\CodexSandbox') {
  throw 'Open PowerShell in the intended employee Windows session, then run Install.'
}

$existing = @($taskNames | Where-Object { Get-ScheduledTask -TaskName $_ -ErrorAction SilentlyContinue })
if ($existing.Count -eq 2 -and (Test-Path -LiteralPath $tokenPath) -and (Test-Path -LiteralPath $profile) -and
    (Test-Path -LiteralPath $credentialPath) -and (Test-Path -LiteralPath $launcher) -and (Test-Path -LiteralPath $watcher)) {
  Write-Host 'Training and the activity watcher are already configured for this Windows user.'
  return
}
if ($existing.Count) { throw 'A partial setup exists. Run this file with -Mode Remove, then rerun Install.' }
$legacyTask = Get-ScheduledTask -TaskName $legacyWatcherTask -ErrorAction SilentlyContinue
if ($legacyTask -and $legacyTask.State -ne 'Disabled') {
  throw 'The legacy watcher task is still enabled. Review and disable it before installing ActivityWatch to prevent double reporting.'
}

Write-Host "Setting up the Windows account $($identity.Name). Use the same employee for dashboard enrollment and the work token."
$consentReply = Read-Host 'Has the employee accepted attendance and app-usage consent in the dashboard? Type yes to continue'
if ($consentReply.Trim() -ine 'yes') {
  Write-Host 'Setup cancelled before making changes.'
  return
}

Assert-Script $launcherSource
Assert-Script $watcherSource
Add-Type -AssemblyName System.Security
$protectedToken = Read-ProtectedWorkToken

while ($true) {
  $password = Read-PrivateText 'Admin SEB recovery password (12 or more characters, blank cancels)'
  if ([string]::IsNullOrEmpty($password)) { throw 'Setup cancelled before any changes.' }
  if ($password.Length -lt 12) {
    Write-Warning 'Enter at least 12 characters.'
    continue
  }
  if ($password -ceq (Read-PrivateText 'Confirm the admin recovery password')) { break }
  Write-Warning 'The entries differ. Enter the same recovery password twice, including capitalization.'
}
$sha = [Security.Cryptography.SHA256]::Create()
$passwordBytes = [Text.Encoding]::UTF8.GetBytes($password)
try { $quitHash = [BitConverter]::ToString($sha.ComputeHash($passwordBytes)).Replace('-', '') }
finally {
  $sha.Dispose()
  [Array]::Clear($passwordBytes, 0, $passwordBytes.Length)
  $password = $null
}

Ensure-Seb
Ensure-ActivityWatch

$newCredential = !(Test-Path -LiteralPath $credentialPath -PathType Leaf)
if ($newCredential) {
  Write-Host "In a normal browser, sign in as the employee and get a fresh code at $dashboard/seb-code."
  $code = (Read-PrivateText 'Enter the one-time SEB enrollment code').Trim()
  if (!$code) { throw 'A one-time SEB code is required.' }
  try {
    $body = @{ code = $code; windowsUser = $sid; enroll = $true; label = $env:COMPUTERNAME } | ConvertTo-Json -Compress
    $result = Invoke-RestMethod -Method Post -Uri "$dashboard/api/seb/check-in" -ContentType 'application/json' -Body $body -MaximumRedirection 0 -TimeoutSec 20
    if (!$result.enrollment.id -or !$result.enrollment.secret) { throw 'The dashboard did not confirm enrollment.' }
    $credential = @{ id = $result.enrollment.id; secret = $result.enrollment.secret } | ConvertTo-Json -Compress
    $protectedEnrollment = [Convert]::ToBase64String((Protect-Text $credential))
  } finally {
    $code = $null
    $body = $null
    $credential = $null
    $result = $null
  }
}

$createdTasks = [Collections.Generic.List[string]]::new()
try {
  [void][IO.Directory]::CreateDirectory($installDir)
  # Signed release: build-signed-release.ps1 ships Authenticode-signed copies of these two scripts next
  # to this file (same content as the sources above). Install those so Windows and Seqrite see the
  # company signature; otherwise (unsigned dev copy) write the embedded sources as before.
  foreach ($pair in @(@($launcher, $launcherSource), @($watcher, $watcherSource))) {
    $signedCopy = Join-Path $PSScriptRoot (Split-Path -Leaf $pair[0])
    if (Test-Path -LiteralPath $signedCopy -PathType Leaf) {
      $sig = Get-AuthenticodeSignature -LiteralPath $signedCopy
      if ($sig.Status -ne 'Valid') { throw "$(Split-Path -Leaf $signedCopy) signature is $($sig.Status). Install the company certificate first (trust-company-cert.ps1)." }
      $body = ([IO.File]::ReadAllText($signedCopy) -split '\r?\n# SIG # Begin signature block')[0]
      if (($body -replace '\r\n', "`n").TrimEnd() -ne ($pair[1] -replace '\r\n', "`n").TrimEnd()) {
        throw "$(Split-Path -Leaf $signedCopy) does not match this setup version. Rebuild with build-signed-release.ps1."
      }
      Copy-Item -LiteralPath $signedCopy -Destination $pair[0] -Force
    } else {
      [IO.File]::WriteAllText($pair[0], $pair[1])
    }
  }
  & $shell -NoProfile -NonInteractive -ExecutionPolicy RemoteSigned -File $watcher -Check
  if ($LASTEXITCODE -ne 0) { throw 'ActivityWatch app-only data check failed.' }
  [IO.File]::WriteAllText($profile, $profileSource.Replace('__ADMIN_QUIT_HASH__', $quitHash))
  [IO.File]::WriteAllBytes($tokenPath, $protectedToken)
  if ($newCredential) {
    [IO.File]::WriteAllText($credentialPath, $protectedEnrollment)
  }
  [void](Register-ScheduledTask -TaskName $watcherTask -Xml $watcherXml)
  $createdTasks.Add($watcherTask)
  Start-ScheduledTask -TaskName $watcherTask
  $startupDeadline = [DateTime]::UtcNow.AddSeconds(25)
  do {
    if (!(Test-Path -LiteralPath $watcher -PathType Leaf)) {
      throw 'The watcher file disappeared after setup wrote it. Ask IT to check the endpoint protection log.'
    }
    if ((Get-ScheduledTask -TaskName $watcherTask).State -eq 'Running' -and
        (Test-Path -LiteralPath $watcherLog -PathType Leaf) -and
        (Select-String -LiteralPath $watcherLog -Pattern 'ActivityWatch bridge started' -Quiet)) { break }
    if ([DateTime]::UtcNow -ge $startupDeadline) {
      throw 'The watcher did not start. Check its Task Scheduler result before continuing with training setup.'
    }
    Start-Sleep -Seconds 1
  } while ($true)
  [void](Register-ScheduledTask -TaskName $sebTask -Xml $sebXml)
  $createdTasks.Add($sebTask)
} catch {
  foreach ($name in $createdTasks) {
    Stop-ScheduledTask -TaskName $name -ErrorAction SilentlyContinue
    Unregister-ScheduledTask -TaskName $name -Confirm:$false -ErrorAction SilentlyContinue
  }
  # Preserve enrollment so a retry can reuse the link already created on the dashboard.
  if (Test-Path -LiteralPath $tokenPath) { Remove-Item -LiteralPath $tokenPath -ErrorAction SilentlyContinue }
  throw
}

Write-Host 'Setup registered the watcher and training tasks for this employee.'
Write-Host 'ActivityWatch bridge started. Training checks at the next sign-in and daily at 09:00 IST.'
Write-Host 'Save your work and restart once to verify this Windows account starts the expected components.'
