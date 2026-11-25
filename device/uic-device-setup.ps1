#Requires -Version 5
<#
  USAIndiaCFO device setup - ALL IN ONE. Run as Administrator on the employee laptop.

  One file. It writes the activity watcher + the SEB launcher + the SEB config to disk (they are embedded
  below - nothing else to copy from us), installs Safe Exam Browser, sets the laptop to stay awake and to
  auto-connect Wi-Fi, registers the watcher and the SEB launcher to run at every logon, and runs a test.

  USAGE (PowerShell, Run as administrator):
    powershell -ExecutionPolicy Bypass -File uic-device-setup.ps1 -Dashboard "https://seo.usaindiacfo.us" -Token "THE-PERSONS-WORK-TOKEN"

  The Token is that employee's work token from the dashboard: Team Training -> Device setup -> "Get token".
  It identifies the person for BOTH the activity watcher and SEB (no code is ever typed).

  Options:
    -SebInstallerUrl "<direct .exe/.msi URL>"  Install SEB silently from this URL. If omitted and SEB is
                                               missing, the SEB download page is opened to install by hand.
    -SkipSeb         Do not touch SEB (only watcher + power + Wi-Fi + tasks).
    -SkipWatcher     Do not set up the activity watcher.
    -TestOnly        Change nothing; just run the SEB launcher once and print what it would do.

  IMPORTANT: test on ONE spare laptop first. SEB locks the screen while a lesson/test is open. Keep an
  admin/quit password in the SEB config (see the note printed at the end) so an admin can always exit SEB.
#>
param(
  [Parameter(Mandatory = $true)][string]$Dashboard,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$SebInstallerUrl = "",
  [switch]$SkipSeb,
  [switch]$SkipWatcher,
  [switch]$TestOnly,
  [switch]$SkipTest
)

$ErrorActionPreference = 'Stop'
$Dashboard = $Dashboard.TrimEnd('/')
$UIC = 'C:\UIC'
$PD  = 'C:\ProgramData\UIC'
$SebExe = "$env:ProgramFiles\SafeExamBrowser\Application\SafeExamBrowser.exe"
$logFile = Join-Path $env:TEMP 'uic-device-setup.log'

function Log($m) { $line = ('[{0}] {1}' -f (Get-Date -Format 'HH:mm:ss'), $m); Write-Host $line; try { Add-Content -Path $logFile -Value $line } catch {} }
function WriteFileNoBom($path, $content) {
  $dir = Split-Path $path; if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Force -Path $dir | Out-Null }
  [IO.File]::WriteAllText($path, $content, (New-Object System.Text.UTF8Encoding($false)))
}

# ---------------------------------------------------------------------------------------------------------
# Embedded files (generated from device/uic-watcher.ps1, device/uic-seb-launcher.ps1, device/uic.seb).
# Single-quoted here-strings: everything between @' and '@ is written out verbatim.
# ---------------------------------------------------------------------------------------------------------
$WATCHER = @'
# USAIndiaCFO activity watcher (Windows, PowerShell 5+).
# Reports which app was active and for how long to the dashboard, for the person's timesheet.
# It counts only active time: when the person is idle (no keyboard/mouse) past IdleSeconds, that time
# is NOT counted, so it becomes the "gap" the dashboard logs to the General task (meetings, offline).
#
# Run (once set up it runs itself at logon, see device/README.md):
#   powershell -ExecutionPolicy Bypass -File uic-watcher.ps1 -Dashboard "https://YOUR-DASHBOARD" -Token "THE-PERSONS-WORK-TOKEN"
# Or set the environment variables UIC_DASHBOARD and UIC_WORK_TOKEN and run with no arguments.

param(
  [string]$Dashboard = $env:UIC_DASHBOARD,
  [string]$Token = $env:UIC_WORK_TOKEN,
  [int]$PostSeconds = 60,     # how often to send a report
  [int]$IdleSeconds = 120     # no input for this long = not active (becomes the gap)
)

if (-not $Dashboard -or -not $Token) {
  Write-Error "Set -Dashboard and -Token (or the UIC_DASHBOARD and UIC_WORK_TOKEN environment variables)."
  exit 1
}
$Dashboard = $Dashboard.TrimEnd('/')

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class UicWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
  [StructLayout(LayoutKind.Sequential)] public struct LASTINPUTINFO { public uint cbSize; public uint dwTime; }
  [DllImport("user32.dll")] public static extern bool GetLastInputInfo(ref LASTINPUTINFO plii);
  public static uint IdleMs() {
    LASTINPUTINFO l = new LASTINPUTINFO(); l.cbSize = (uint)Marshal.SizeOf(l);
    if (!GetLastInputInfo(ref l)) return 0;
    return ((uint)Environment.TickCount) - l.dwTime;
  }
}
"@

$acc = @{}                     # app name -> active milliseconds since the last post
$last = Get-Date
$lastPost = Get-Date

while ($true) {
  Start-Sleep -Milliseconds 5000
  $now = Get-Date
  $delta = [int][math]::Min((($now - $last).TotalMilliseconds), 60000)
  $last = $now

  # Only count active time (skip when the person is idle).
  if ([UicWin]::IdleMs() -lt ($IdleSeconds * 1000)) {
    try {
      $h = [UicWin]::GetForegroundWindow()
      $procId = 0; [void][UicWin]::GetWindowThreadProcessId($h, [ref]$procId)
      $p = Get-Process -Id $procId -ErrorAction SilentlyContinue
      $app = if ($p -and $p.ProcessName) { $p.ProcessName } else { "Unknown" }
    } catch { $app = "Unknown" }
    if ($acc.ContainsKey($app)) { $acc[$app] += $delta } else { $acc[$app] = $delta }
  }

  if ((($now - $lastPost).TotalSeconds) -ge $PostSeconds) {
    if ($acc.Count -gt 0) {
      $apps = @()
      foreach ($k in $acc.Keys) { $apps += @{ app = $k; ms = $acc[$k] } }
      $body = @{ apps = $apps } | ConvertTo-Json -Depth 4 -Compress
      try {
        Invoke-RestMethod -Uri "$Dashboard/api/worklog/report" -Method Post `
          -Headers @{ "x-work-token" = $Token; "Content-Type" = "application/json" } `
          -Body $body -TimeoutSec 20 | Out-Null
      } catch { }
      $acc = @{}
    }
    $lastPost = $now
  }
}
'@

$LAUNCHER = @'
# USAIndiaCFO SEB launcher (Windows, PowerShell 5+).
# No code is ever typed. The device is verified ONCE by its work token (the SAME token installed for the
# activity watcher). On every logon it asks the dashboard whether training is pending and opens Safe Exam
# Browser only then; a finished day, a no-training day, or before 09:00 IST leaves the desktop alone.

param(
  [string]$Dashboard = $env:UIC_DASHBOARD,
  [string]$Token = $env:UIC_WORK_TOKEN,
  [string]$SebExe = "$env:ProgramFiles\SafeExamBrowser\Application\SafeExamBrowser.exe",
  [string]$SebConfig = "$env:ProgramData\UIC\uic.seb"
)
if (-not $Dashboard) { Write-Error "Set -Dashboard (or UIC_DASHBOARD)."; exit 1 }
if (-not $Token) { Write-Error "Set -Token (the person's work token from the dashboard Device setup)."; exit 1 }
$Dashboard = $Dashboard.TrimEnd('/')

function Open-Seb([string]$code) {
  if (-not (Test-Path $SebExe)) { Write-Error "SafeExamBrowser.exe not found at $SebExe."; return $false }
  if (-not (Test-Path $SebConfig)) { Write-Error "SEB config not found at $SebConfig."; return $false }
  $url = "$Dashboard/seb#code=$code"
  $raw = [IO.File]::ReadAllText($SebConfig)
  if ($raw -notmatch '__START_URL__') { Write-Error "SEB config has no __START_URL__ placeholder."; return $false }
  $tmp = Join-Path $env:TEMP ("uic-seb-" + [Guid]::NewGuid().ToString('N') + ".seb")
  try {
    [IO.File]::WriteAllText($tmp, $raw.Replace('__START_URL__', $url))
    Start-Process -FilePath $SebExe -ArgumentList @($tmp) | Out-Null
    return $true
  } catch { Write-Error "Could not launch SEB: $($_.Exception.Message)"; return $false }
}

function Token-Exchange {
  try {
    $r = Invoke-RestMethod -Uri "$Dashboard/api/seb/token-session" -Method Post -Headers @{ 'x-work-token' = $Token } -TimeoutSec 20
    return @{ outcome = 'ok'; status = $r.status; launch = [bool]$r.launch; code = $r.code }
  } catch {
    $resp = $_.Exception.Response
    $statusCode = $null
    if ($resp -and ($resp.PSObject.Properties.Name -contains 'StatusCode')) { try { $statusCode = [int]$resp.StatusCode } catch { $statusCode = $null } }
    if ($statusCode -eq 401) { return @{ outcome = 'not_set_up' } }
    return @{ outcome = 'transient'; message = $_.Exception.Message }
  }
}

$res = Token-Exchange
switch ($res.outcome) {
  'ok' {
    if ($res.launch -and $res.code) { if (Open-Seb $res.code) { exit 0 } else { exit 1 } }
    Write-Host "No training to open now (status: $($res.status)). Desktop stays available."
    exit 0
  }
  'not_set_up' { Write-Error "This device's work token is not recognised. Set the correct -Token (and make sure the person is enrolled)."; exit 1 }
  'transient'  { Write-Warning "Could not reach the dashboard ($($res.message)). Will try again at the next logon."; exit 0 }
}
'@

$SEBCONF = @'
<?xml version="1.0" encoding="UTF-8"?>
<!-- USAIndiaCFO SEB config. The launcher replaces __START_URL__ with a fresh one-time URL at launch.
     Set a real hashedQuitPassword below (via the SEB Configuration Tool) so an admin can exit SEB. -->
<plist version="1.0">
<dict>
  <key>startURL</key>
  <string>__START_URL__</string>
  <key>quitURL</key>
  <string>https://seo.usaindiacfo.us/seb/quit</string>
  <key>quitURLConfirm</key>
  <false/>
  <key>browserViewMode</key>
  <integer>1</integer>
  <key>mainBrowserWindowWidth</key>
  <string>100%</string>
  <key>mainBrowserWindowHeight</key>
  <string>100%</string>
  <key>enableBrowserWindowToolbar</key>
  <false/>
  <key>showMenuBar</key>
  <false/>
  <key>showTaskBar</key>
  <true/>
  <key>allowQuit</key>
  <true/>
  <key>hashedQuitPassword</key>
  <string></string>
  <key>allowReload</key>
  <true/>
  <key>showReloadButton</key>
  <true/>
  <key>allowBrowsingBackForward</key>
  <false/>
  <key>newBrowserWindowByLinkPolicy</key>
  <integer>0</integer>
  <key>newBrowserWindowByScriptPolicy</key>
  <integer>0</integer>
  <key>allowDownUploads</key>
  <false/>
  <key>allowSpellCheck</key>
  <false/>
  <key>URLFilterEnable</key>
  <true/>
  <key>URLFilterEnableContentFilter</key>
  <false/>
  <key>whitelistURLFilter</key>
  <string>seo.usaindiacfo.us/*</string>
  <key>sebConfigPurpose</key>
  <integer>0</integer>
  <key>sendBrowserExamKey</key>
  <true/>
</dict>
</plist>
'@

# ---------------------------------------------------------------------------------------------------------
function Assert-Admin {
  $id = [Security.Principal.WindowsIdentity]::GetCurrent()
  $pr = New-Object Security.Principal.WindowsPrincipal($id)
  if (-not $pr.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    Write-Error "Run this in an ADMINISTRATOR PowerShell (right-click PowerShell -> Run as administrator)."
    exit 1
  }
}

function Write-DeviceFiles {
  Log "Writing C:\UIC and C:\ProgramData\UIC files..."
  if (-not $SkipWatcher) { WriteFileNoBom (Join-Path $UIC 'uic-watcher.ps1') $WATCHER }
  if (-not $SkipSeb) {
    WriteFileNoBom (Join-Path $UIC 'uic-seb-launcher.ps1') $LAUNCHER
    WriteFileNoBom (Join-Path $PD  'uic.seb') $SEBCONF
  }
  Log "Files written."
}

function Set-AlwaysOn {
  Log "Keeping the laptop awake (screen and sleep off) so activity never breaks..."
  foreach ($c in @('monitor-timeout-ac 0','monitor-timeout-dc 0','standby-timeout-ac 0','standby-timeout-dc 0','hibernate-timeout-ac 0','hibernate-timeout-dc 0')) {
    try { Start-Process powercfg -ArgumentList ('/change ' + $c) -Wait -NoNewWindow } catch { Log "powercfg $c failed: $($_.Exception.Message)" }
  }
  Log "Power settings set to stay on."
}

function Set-WifiAutoConnect {
  Log "Setting Wi-Fi profiles to auto-connect..."
  try {
    $names = (netsh wlan show profiles) | Select-String 'All User Profile' | ForEach-Object { ($_ -split ':', 2)[1].Trim() }
    foreach ($n in $names) { if ($n) { netsh wlan set profileparameter name="$n" connectionmode=auto | Out-Null; Log "  auto-connect: $n" } }
    if (-not $names) { Log "  no saved Wi-Fi profiles found (connect once, then re-run to make it auto)." }
  } catch { Log "Wi-Fi auto-connect step skipped: $($_.Exception.Message)" }
}

function Install-Seb {
  if ($SkipSeb) { return }
  if (Test-Path $SebExe) { Log "SEB already installed."; return }
  if ($SebInstallerUrl) {
    Log "Downloading Safe Exam Browser installer..."
    $dl = Join-Path $env:TEMP ('seb-setup' + [IO.Path]::GetExtension($SebInstallerUrl))
    try {
      Invoke-WebRequest -Uri $SebInstallerUrl -OutFile $dl -UseBasicParsing
      if ($dl -match '\.msi$') { Start-Process msiexec -ArgumentList @('/i', $dl, '/quiet', '/norestart') -Wait }
      else { Start-Process $dl -ArgumentList '/quiet' -Wait }   # best-effort silent; may still show UI
      if (Test-Path $SebExe) { Log "SEB installed." } else { Log "SEB installer ran but SafeExamBrowser.exe was not found - finish the install by hand, then re-run." }
    } catch { Log "SEB download/install failed: $($_.Exception.Message). Install SEB by hand from safeexambrowser.org, then re-run." }
  } else {
    Log "SEB is not installed and no -SebInstallerUrl was given. Opening the SEB download page; install SEB (3.x for Windows), then re-run this script."
    try { Start-Process 'https://safeexambrowser.org/download_en.html' } catch {}
  }
}

function Register-LogonTask($name, $scriptPath) {
  $argLine = '-WindowStyle Hidden -ExecutionPolicy Bypass -File "' + $scriptPath + '" -Dashboard "' + $Dashboard + '" -Token "' + $Token + '"'
  $act = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument $argLine
  $trg = New-ScheduledTaskTrigger -AtLogOn
  $set = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
  Register-ScheduledTask -TaskName $name -Action $act -Trigger $trg -Settings $set -RunLevel Limited -Force | Out-Null
  Log "Scheduled task registered: $name"
}

function Test-Launcher {
  if ($SkipSeb) { return }
  Log "TEST: running the SEB launcher once (it opens SEB only if training is pending now)..."
  try {
    $out = & powershell.exe -ExecutionPolicy Bypass -File (Join-Path $UIC 'uic-seb-launcher.ps1') -Dashboard $Dashboard -Token $Token 2>&1
    Log ("Launcher said: " + (($out | Out-String).Trim()))
  } catch { Log "Launcher test error: $($_.Exception.Message)" }
}

# ---------------------------------------------------------------------------------------------------------
Assert-Admin
Log "USAIndiaCFO device setup starting. Dashboard=$Dashboard  (log: $logFile)"

if ($TestOnly) { Test-Launcher; Log "TestOnly done."; return }

Write-DeviceFiles
Set-AlwaysOn
Set-WifiAutoConnect
Install-Seb
if (-not $SkipWatcher) { Register-LogonTask 'UIC Watcher'      (Join-Path $UIC 'uic-watcher.ps1') }
if (-not $SkipSeb)     { Register-LogonTask 'UIC SEB Launcher' (Join-Path $UIC 'uic-seb-launcher.ps1') }
if (-not $SkipTest) { Test-Launcher } else { Log "SkipTest set: not opening SEB now (it will run at the next logon)." }

Write-Host ""
Write-Host "================= DONE - now, by hand (once) ================="
Write-Host "1. Employee signs into $Dashboard in their normal browser and clicks 'Connect Zoho People' (so attendance records under their name)."
Write-Host "2. Set a quit password in the SEB config so an admin can exit SEB: open C:\ProgramData\UIC\uic.seb in the SEB Configuration Tool, set a Quit Password, save (keep startURL = __START_URL__)."
Write-Host "3. The employee must be ENROLLED and ACTIVE in the dashboard (Settings -> Training Enrollment), and it must be a training day after 09:00 IST, for SEB to open."
Write-Host "4. To verify the watcher: wait ~2 minutes, then check the dashboard (Team Training -> Work time) for this person's activity."
Write-Host "To remove later: Unregister-ScheduledTask -TaskName 'UIC Watcher' -Confirm:`$false ; Unregister-ScheduledTask -TaskName 'UIC SEB Launcher' -Confirm:`$false"
Write-Host "============================================================="
Write-Host ""
Write-Host "=== IF THE SEB 'Check In' (attendance) BUTTON DOES NOTHING: Zoho People is not connected ==="
Write-Host "Check In records attendance in Zoho People. It only works after the person connects Zoho People."
Write-Host "  A) EMPLOYEE (in their normal browser, signed in): open $Dashboard  ->  top banner 'Zoho People' -> Connect,"
Write-Host "     or open $Dashboard/api/zoho-people/auth-url  -> Accept. When it turns green 'Connected', Check In works."
Write-Host "  B) ZOHO ADMIN (one time, in the Zoho API console at https://api-console.zoho.com):"
Write-Host "     - The OAuth app must have the Authorized Redirect URI EXACTLY: $Dashboard/api/zoho-people/oauth-callback"
Write-Host "     - The scope ZOHOPEOPLE.attendance.ALL must be allowed for the app."
Write-Host "     - The Zoho People plan must include the Attendance API (adding a check-in via API)."
Write-Host "     Nothing else changes on the dashboard side - the data center is detected automatically."
Write-Host "  If connect shows an error, open $Dashboard/api/zoho-people/diagnostics (as admin) and send it to support."
Write-Host "============================================================="
