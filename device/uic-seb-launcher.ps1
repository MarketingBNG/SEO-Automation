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
  [string]$SebConfig = "$env:ProgramData\UIC\uic.seb"  # base SEB config; startURL must be __START_URL__
)
if (-not $Dashboard) { Write-Error "Set -Dashboard (or UIC_DASHBOARD)."; exit 1 }
$Dashboard = $Dashboard.TrimEnd('/')
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

# Open SEB AT a fresh single-use code, inside the SEB config. The URL is NEVER handed to the default
# browser: it is written into a temp copy of the SEB config (startURL) and SEB is launched on that config,
# so the page only ever opens inside the locked-down browser.
function Open-Seb([string]$code) {
  if (-not (Test-Path $SebExe)) { Write-Error "SafeExamBrowser.exe not found at $SebExe."; return $false }
  if (-not (Test-Path $SebConfig)) { Write-Error "SEB config not found at $SebConfig."; return $false }
  $url = "$Dashboard/seb#code=$code"
  $raw = [IO.File]::ReadAllText($SebConfig)
  if ($raw -notmatch '__START_URL__') { Write-Error "SEB config has no __START_URL__ placeholder; cannot inject the start URL safely."; return $false }
  $tmp = Join-Path $env:TEMP ("uic-seb-" + [Guid]::NewGuid().ToString('N') + ".seb")
  try {
    [IO.File]::WriteAllText($tmp, $raw.Replace('__START_URL__', $url))
    Start-Process -FilePath $SebExe -ArgumentList @($tmp) | Out-Null
    return $true
  } catch {
    Write-Error "Could not launch SEB: $($_.Exception.Message)"
    return $false
  }
  # SEB reads the config at launch; the temp file is left for SEB to open and cleaned up by TEMP hygiene.
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
    $r = Invoke-RestMethod -Uri "$Dashboard/api/seb/enroll-session" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
    return @{ outcome = 'ok'; status = $r.status; launch = [bool]$r.launch; code = $r.code }
  } catch {
    # Only an HTTP 401 means the enrollment is no longer valid. A timeout / DNS / connection failure has no
    # Response; a 5xx has one but is not 401. Keep the credential in both those cases.
    $resp = $_.Exception.Response
    $statusCode = $null
    if ($resp -and ($resp.PSObject.Properties.Name -contains 'StatusCode')) {
      try { $statusCode = [int]$resp.StatusCode } catch { $statusCode = $null }
    }
    if ($statusCode -eq 401) { return @{ outcome = 'rejected' } }
    return @{ outcome = 'transient'; message = $_.Exception.Message }
  }
}

# Act on the exchange result: launch SEB only when the gate says pending; otherwise leave the desktop.
function Invoke-GateResult($res) {
  switch ($res.outcome) {
    'ok' {
      if ($res.launch -and $res.code) {
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
