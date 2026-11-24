# USAIndiaCFO SEB launcher (Windows, PowerShell 5+). DEVICE-SIDE; NOT tested on Windows here.
#
# No code is ever typed. The device is verified ONCE by its work token (the SAME token you install for the
# activity watcher, from the dashboard's Device setup). On every logon/reboot this launcher:
#   1. sends that token to the dashboard, which resolves the person and runs the training gate, and
#   2. opens Safe Exam Browser ONLY when training is pending (at/after 09:00 IST on a training day that is
#      not yet done). On a no-training day, before 09:00, or after the day is finished, SEB does NOT open
#      and the normal desktop stays available. A finished day never reopens SEB.
#
# The token is the one-time verification; it is never asked for again and never put in a URL. SEB only
# receives a fresh single-use code in the config's start URL (/seb#code=...), which the page redeems.
#
# Run at logon. Configure -Dashboard and -Token (per person), and $SebExe/$SebConfig for your SEB setup.
# The base $SebConfig MUST contain the placeholder __START_URL__ as its startURL (see device/uic.seb).

param(
  [string]$Dashboard = $env:UIC_DASHBOARD,
  [string]$Token = $env:UIC_WORK_TOKEN,   # the person's work token (same as the activity watcher)
  [string]$SebExe = "$env:ProgramFiles\SafeExamBrowser\Application\SafeExamBrowser.exe",
  [string]$SebConfig = "$env:ProgramData\UIC\uic.seb"  # base SEB config; startURL must be __START_URL__
)
if (-not $Dashboard) { Write-Error "Set -Dashboard (or UIC_DASHBOARD)."; exit 1 }
if (-not $Token) { Write-Error "Set -Token (the person's work token from the dashboard Device setup)."; exit 1 }
$Dashboard = $Dashboard.TrimEnd('/')

# Open SEB AT a fresh single-use code, inside the SEB config. The URL is NEVER handed to the default
# browser: it is written into a temp copy of the SEB config (startURL) and SEB is launched on that config.
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

# Exchange the work token for the gate decision. Returns:
#   @{ outcome='ok'; status; launch; code }  -> launch/code per the gate
#   @{ outcome='not_set_up' }                 -> 401: the token is unknown (device not set up / token wrong)
#   @{ outcome='transient'; message }         -> no answer / server error: keep trying next logon, no launch
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
    if ($res.launch -and $res.code) {
      if (Open-Seb $res.code) { exit 0 } else { exit 1 }
    }
    # before-window / no-training / done / not-ready: desktop stays available, SEB does not open.
    Write-Host "No training to open now (status: $($res.status)). Desktop stays available."
    exit 0
  }
  'not_set_up' {
    Write-Error "This device's work token is not recognised. Set the correct -Token from the dashboard Device setup (and make sure the person is enrolled)."
    exit 1
  }
  'transient' {
    Write-Warning "Could not reach the dashboard ($($res.message)). Will try again at the next logon."
    exit 0
  }
}
