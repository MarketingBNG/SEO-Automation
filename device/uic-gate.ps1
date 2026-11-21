# USAIndiaCFO device lock gate (Windows, PowerShell 5+).
# Polls the dashboard: is this person's training done for today? While it is NOT done (and it is after
# 09:00 IST), the laptop is held on the dashboard in a fullscreen kiosk window, so only the lesson is
# usable. As soon as the lesson/test is done, the kiosk closes and the laptop is free for the rest of
# the day. A reboot does not re-lock once the day is done (the dashboard remembers it).
#
# This is the REVERSIBLE lock: it only opens and closes an Edge kiosk window, it does not change any
# Windows policy. To stop it: Unregister-ScheduledTask -TaskName "UIC Gate" -Confirm:$false
# It FAILS OPEN: on any network error it does not lock, so a person is never trapped by a bad link.
#
# Run (set up to run at logon, see device/README.md):
#   powershell -ExecutionPolicy Bypass -File uic-gate.ps1 -Dashboard "https://YOUR-DASHBOARD" -Token "THE-PERSONS-WORK-TOKEN"

param(
  [string]$Dashboard = $env:UIC_DASHBOARD,
  [string]$Token = $env:UIC_WORK_TOKEN,
  [int]$PollSeconds = 20
)

if (-not $Dashboard -or -not $Token) {
  Write-Error "Set -Dashboard and -Token (or the UIC_DASHBOARD and UIC_WORK_TOKEN environment variables)."
  exit 1
}
$Dashboard = $Dashboard.TrimEnd('/')

$edge = Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe" }
if (-not (Test-Path $edge)) { Write-Error "Microsoft Edge not found; the kiosk lock needs Edge."; exit 1 }

function Test-Locked {
  try {
    $r = Invoke-RestMethod -Uri "$Dashboard/api/worklog/gate" -Method Get `
      -Headers @{ "x-work-token" = $Token } -TimeoutSec 20
    return [bool]$r.locked
  } catch {
    return $false   # fail open: never trap the user on a network error
  }
}

$kiosk = $null
while ($true) {
  $locked = Test-Locked
  $alive = $kiosk -and -not $kiosk.HasExited
  if ($locked -and -not $alive) {
    $kiosk = Start-Process -FilePath $edge -PassThru -ArgumentList @(
      "--kiosk", "$Dashboard",
      "--edge-kiosk-type=fullscreen",
      "--no-first-run",
      "--disable-features=TranslateUI"
    )
  } elseif (-not $locked -and $alive) {
    try {
      $kiosk.CloseMainWindow() | Out-Null
      Start-Sleep -Seconds 2
      if (-not $kiosk.HasExited) { $kiosk.Kill() }
    } catch { }
    $kiosk = $null
  }
  Start-Sleep -Seconds $PollSeconds
}
