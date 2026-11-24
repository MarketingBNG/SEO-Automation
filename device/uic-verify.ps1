#Requires -Version 5
<#
  USAIndiaCFO device verify + self-heal. Run as Administrator.

  Checks the whole setup and FIXES anything missing on its own (by re-running the installer's setup
  script). It also tells you the things only you can do (connect Zoho People in the browser, enrol the
  person) - it cannot do those from the device.

  Usage (PowerShell as admin):
    powershell -ExecutionPolicy Bypass -File uic-verify.ps1
  It reads the dashboard + work token from the installed scheduled task. Or pass them:
    powershell -ExecutionPolicy Bypass -File uic-verify.ps1 -Dashboard "https://seo.usaindiacfo.us" -Token "THE-TOKEN"
#>
param(
  [string]$Dashboard = '',
  [string]$Token = ''
)
$ErrorActionPreference = 'Continue'
$UIC = 'C:\UIC'
$PD  = 'C:\ProgramData\UIC'
$SebExe = "$env:ProgramFiles\SafeExamBrowser\Application\SafeExamBrowser.exe"

function Get-TaskArg($taskName, $flag) {
  try {
    $t = Get-ScheduledTask -TaskName $taskName -ErrorAction Stop
    $a = $t.Actions[0].Arguments
    if ($a -match ('-' + $flag + '\s+"([^"]+)"')) { return $Matches[1] }
  } catch {}
  return ''
}

# Recover dashboard + token from the installed tasks if not passed.
if (-not $Token)     { $Token     = Get-TaskArg 'UIC Watcher' 'Token';     if (-not $Token)     { $Token     = Get-TaskArg 'UIC SEB Launcher' 'Token' } }
if (-not $Dashboard) { $Dashboard = Get-TaskArg 'UIC Watcher' 'Dashboard'; if (-not $Dashboard) { $Dashboard = Get-TaskArg 'UIC SEB Launcher' 'Dashboard' } }
if (-not $Dashboard) { $Dashboard = 'https://seo.usaindiacfo.us' }
$Dashboard = $Dashboard.TrimEnd('/')

$fails = New-Object System.Collections.ArrayList
function Check($name, $ok, $hint) {
  if ($ok) { Write-Host ('  [ OK ] ' + $name) -ForegroundColor Green }
  else { Write-Host ('  [MISS] ' + $name + '   -> ' + $hint) -ForegroundColor Yellow; [void]$fails.Add($name) }
}

function Run-Checks {
  $script:fails = New-Object System.Collections.ArrayList
  Write-Host "`nDevice files & SEB:"
  Check 'Watcher script (C:\UIC\uic-watcher.ps1)'        (Test-Path "$UIC\uic-watcher.ps1")       'will recreate'
  Check 'SEB launcher (C:\UIC\uic-seb-launcher.ps1)'     (Test-Path "$UIC\uic-seb-launcher.ps1")  'will recreate'
  $cfg = Test-Path "$PD\uic.seb"
  Check 'SEB config (C:\ProgramData\UIC\uic.seb)'        $cfg                                     'will recreate'
  if ($cfg) { Check 'SEB config keeps __START_URL__'     (((Get-Content "$PD\uic.seb" -Raw) -match '__START_URL__')) 'will recreate' }
  Check 'Safe Exam Browser installed'                    (Test-Path $SebExe)                      'install SEB'

  Write-Host "`nScheduled tasks (run at logon):"
  Check 'Task: UIC Watcher'      ([bool](Get-ScheduledTask -TaskName 'UIC Watcher' -ErrorAction SilentlyContinue))      'will register'
  Check 'Task: UIC SEB Launcher' ([bool](Get-ScheduledTask -TaskName 'UIC SEB Launcher' -ErrorAction SilentlyContinue)) 'will register'

  Write-Host "`nPower (stay awake so activity never breaks):"
  $vid = (& powercfg /q SCHEME_CURRENT SUB_VIDEO VIDEOIDLE) 2>$null | Out-String
  Check 'Monitor never turns off (AC)' ($vid -match 'Current AC Power Setting Index:\s*0x00000000') 'will re-apply'

  Write-Host "`nNetwork:"
  $wifi = (netsh wlan show profiles) 2>$null | Select-String 'All User Profile'
  Check 'At least one saved Wi-Fi profile' ([bool]$wifi) 'connect to Wi-Fi once, then re-run'

  Write-Host "`nDashboard + identity (work token):"
  $server = $null
  if ($Token) {
    try {
      $server = Invoke-RestMethod -Uri "$Dashboard/api/seb/token-session" -Method Post -Headers @{ 'x-work-token' = $Token } -TimeoutSec 20
      Check 'Dashboard reachable and token valid (person recognised)' $true ''
      Write-Host ('         training status now: ' + $server.status)
      Check 'Zoho People connected (so attendance Check In works)' ([bool]$server.zohoConnected) 'the EMPLOYEE must open the dashboard in their browser and click "Connect Zoho People"'
    } catch {
      $sc = $null; try { $sc = [int]$_.Exception.Response.StatusCode } catch {}
      if ($sc -eq 401) { Check 'Token valid / person enrolled' $false 'wrong token, or the person is not enrolled (Settings > Training Enrollment)' }
      else { Check 'Dashboard reachable' $false ("could not reach $Dashboard : " + $_.Exception.Message) }
    }
  } else {
    Check 'Work token known' $false 'no token found; run the installer, or pass -Token'
  }
  return $server
}

function Find-Setup {
  foreach ($p in @((Join-Path $PSScriptRoot 'uic-device-setup.ps1'), "$env:ProgramFiles\UIC\uic-device-setup.ps1", "${env:ProgramFiles(x86)}\UIC\uic-device-setup.ps1", "$UIC\uic-device-setup.ps1")) {
    if ($p -and (Test-Path $p)) { return $p }
  }
  return ''
}

Write-Host "USAIndiaCFO device verify. Dashboard=$Dashboard" -ForegroundColor Cyan
$server = Run-Checks

# Self-heal the device-side items (files, SEB files, tasks, power, Wi-Fi) by re-running the setup.
$deviceFails = @($fails | Where-Object { $_ -notlike 'Zoho*' -and $_ -notlike 'Dashboard reachable*' -and $_ -notlike 'Token valid*' })
if ($deviceFails.Count -gt 0) {
  if (-not $Token) { Write-Host "`nCannot self-heal without a work token. Run the installer again, or pass -Token." -ForegroundColor Red }
  else {
    $setup = Find-Setup
    if (-not $setup) {
      Write-Host "`nSome items are missing but uic-device-setup.ps1 was not found. Run the installer (UIC-Device-Setup.exe) again to repair." -ForegroundColor Red
    } else {
      Write-Host "`nRepairing missing items by re-running setup ($setup)..." -ForegroundColor Cyan
      & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $setup -Dashboard $Dashboard -Token $Token -SkipTest
      Write-Host "`nRe-checking after repair:" -ForegroundColor Cyan
      $server = Run-Checks
    }
  }
}

Write-Host "`n================= SUMMARY ================="
if (@($fails).Count -eq 0) {
  Write-Host "Everything is set up. The device will open SEB when training is pending and record activity." -ForegroundColor Green
} else {
  Write-Host "Still needs attention:" -ForegroundColor Yellow
  foreach ($f in $fails) { Write-Host "  - $f" }
  if ($fails -contains 'Zoho People connected (so attendance Check In works)') {
    Write-Host "`n>>> Zoho check-in: the EMPLOYEE must sign into $Dashboard in their normal browser and click 'Connect Zoho People' once. The device cannot do this. If the connect itself shows an error, tell the admin to check /api/zoho-people/diagnostics." -ForegroundColor Yellow
  }
}
Write-Host "==========================================="
