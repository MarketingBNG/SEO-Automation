# USAIndiaCFO SEB launcher (Windows, PowerShell 5+). DEVICE-SIDE; NOT tested on Windows here.
#
# One-time enrollment + silent re-auth for Safe Exam Browser:
#   - First run: no stored credential -> you enter the one-time code (from /seb-code in the regular
#     browser). The launcher links this employee to THIS Windows user, stores a revocable credential
#     securely (DPAPI, per Windows user), and opens SEB.
#   - Later runs/reboots: the launcher silently exchanges the stored credential for a fresh single-use
#     code and opens SEB. No code is asked again unless the enrollment is revoked, the credential is
#     wrong, or a different Windows user signs in (DPAPI + server binding both enforce this).
#
# The durable credential never appears in a URL. SEB only ever receives a fresh single-use code in the
# URL fragment (/seb#code=...), which the page redeems and scrubs.
#
# Run at logon (per user). Configure $Dashboard and $SebExe/$SebConfig for your SEB setup.

param(
  [string]$Dashboard = $env:UIC_DASHBOARD,
  [string]$SebExe = "$env:ProgramFiles\SafeExamBrowser\Application\SafeExamBrowser.exe",
  [string]$SebConfig = "$env:ProgramData\UIC\uic.seb"  # your SEB config whose start URL is the dashboard
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

function Open-Seb([string]$code) {
  $url = "$Dashboard/seb#code=$code"
  if (Test-Path $SebExe) { Start-Process -FilePath $SebExe -ArgumentList @($SebConfig) ; Start-Process $url }
  else { Start-Process $url } # fallback: open the URL (for a dry run outside SEB)
}

function Enroll-Exchange($cred) {
  try {
    $body = @{ id = $cred.id; secret = $cred.secret; windowsUser = $sid } | ConvertTo-Json -Compress
    $r = Invoke-RestMethod -Uri "$Dashboard/api/seb/enroll-session" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
    return $r.code
  } catch {
    # 401 enroll_required (revoked / wrong credential / different Windows user) -> re-enrol.
    return $null
  }
}

$cred = Load-Cred
if ($cred) {
  $code = Enroll-Exchange $cred
  if ($code) { Open-Seb $code; exit 0 }
  Clear-Cred  # enrollment no longer valid -> fall through to first-time
}

# First time (or re-enrol): get the one-time code from /seb-code in the regular browser and enter it.
$code = Read-Host 'Enter the one-time code from the SEB code page'
try {
  $body = @{ code = $code.Trim(); windowsUser = $sid; enroll = $true; label = $env:COMPUTERNAME } | ConvertTo-Json -Compress
  $r = Invoke-RestMethod -Uri "$Dashboard/api/seb/check-in" -Method Post -ContentType 'application/json' -Body $body -TimeoutSec 20
  if (-not $r.enrollment) { Write-Error 'Enrollment was not returned. Check the code and try again.'; exit 1 }
  Save-Cred @{ id = $r.enrollment.id; secret = $r.enrollment.secret }
} catch { Write-Error "Check In failed: $($_.Exception.Message)"; exit 1 }

$fresh = Enroll-Exchange (Load-Cred)
if ($fresh) { Open-Seb $fresh } else { Write-Error 'Could not open an SEB session after enrolling.'; exit 1 }
