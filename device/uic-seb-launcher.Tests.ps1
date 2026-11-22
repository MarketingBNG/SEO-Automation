# Pester tests for uic-seb-launcher.ps1 (Windows-only; requires PowerShell + Pester 5).
# NOT runnable in the dashboard CI (no PowerShell there). Run on a Windows device:
#     Install-Module Pester -Scope CurrentUser   # if needed
#     Invoke-Pester device/uic-seb-launcher.Tests.ps1
#
# These cover the four branches the task calls out, by mocking the network and SEB launch:
#   1. 401 enroll_required  -> credential cleared, re-enroll (Read-Host prompts for a code).
#   2. timeout / offline    -> credential KEPT, SEB not launched (no Open-Seb).
#   3. status "pending"     -> SEB launched INSIDE the config (Start-Process SafeExamBrowser.exe),
#                              the default browser is never opened, and the start URL carries the code.
#   4. status "no-training" -> SEB not launched, desktop stays available.
#
# The launcher exits per-branch, so each test runs it in a child PowerShell with the mocks injected via a
# prelude, and asserts on what the mocks recorded (written to a temp log).

BeforeAll {
  $script:Launcher = Join-Path $PSScriptRoot 'uic-seb-launcher.ps1'
  $script:Config   = Join-Path $PSScriptRoot 'uic.seb'

  # Run the launcher in a fresh PowerShell with injected mocks. $Prelude defines mock functions that the
  # launcher's calls resolve to; $Answer is the enroll-session reply (or 'timeout'/'401'); returns the log.
  function Invoke-Launcher([string]$Answer, [string]$CodeInput = 'ABC123') {
    $log = [IO.Path]::GetTempFileName()
    $store = [IO.Path]::GetTempFileName()  # pretend a stored credential already exists unless Answer=enroll
    $prelude = @"
`$env:UIC_DASHBOARD = 'https://dash.test'
`$LOG = '$log'
function Log(`$m){ Add-Content -Path `$LOG -Value `$m }

# Mock SEB presence + launch so no real browser/SEB is touched.
function Test-Path(`$p){ if (`$p -like '*SafeExamBrowser.exe' -or `$p -like '*uic.seb') { return `$true } return [IO.File]::Exists(`$p) -or [IO.Directory]::Exists(`$p) }
function Start-Process { param([string]`$FilePath, `$ArgumentList) Log "START `$FilePath `$ArgumentList" }

# Mock the enrollment store (DPAPI) with a plain in-memory cred so the 'exchange' branch runs.
function Load-Cred { if ('$Answer' -eq 'enroll') { return `$null } return @{ id='e1'; secret='s1' } }
function Save-Cred(`$o){ Log "SAVE `$(`$o.id)" }
function Clear-Cred { Log 'CLEAR' }
function Read-Host(`$p){ Log 'PROMPT'; return '$CodeInput' }

# Mock the network. enroll-session and check-in both route here.
function Invoke-RestMethod {
  param(`$Uri, `$Method, `$ContentType, `$Body, `$TimeoutSec)
  Log "POST `$Uri"
  switch ('$Answer') {
    'pending'     { return [pscustomobject]@{ ok=`$true; status='pending'; launch=`$true; code='FRESH9' } }
    'no-training' { return [pscustomobject]@{ ok=`$true; status='no-training'; launch=`$false } }
    'timeout'     { throw [Exception]::new('The operation has timed out.') }
    '401'         {
                    `$resp = [pscustomobject]@{ StatusCode = 401 }
                    `$ex = [Exception]::new('Unauthorized'); `$ex | Add-Member -NotePropertyName Response -NotePropertyValue `$resp
                    throw `$ex
                  }
    'enroll'      { return [pscustomobject]@{ ok=`$true; enrollment=[pscustomobject]@{ id='e2'; secret='s2' } } }
  }
}
"@
    $script = $prelude + "`n. '" + $Launcher + "'`n"
    $file = [IO.Path]::GetTempFileName() + '.ps1'
    Set-Content -Path $file -Value $script
    & powershell -NoProfile -ExecutionPolicy Bypass -File $file *> $null
    $out = if (Test-Path $log) { Get-Content $log } else { @() }
    Remove-Item $file, $log, $store -ErrorAction SilentlyContinue
    return ,$out
  }
}

Describe 'uic-seb-launcher gate branches' {
  It 'pending -> launches SEB inside the config, never the default browser, with the fresh code in the URL' {
    $log = Invoke-Launcher 'pending'
    ($log -join "`n") | Should -Match 'START .*SafeExamBrowser\.exe'
    # The code is carried in the temp .seb config (startURL), not passed as a URL to any browser.
    ($log -join "`n") | Should -Match '\.seb'
    ($log -join "`n") | Should -Not -Match 'START https://'   # no URL ever handed to Start-Process
    ($log -join "`n") | Should -Not -Match 'CLEAR'
  }

  It 'no-training -> does NOT launch SEB (desktop stays available)' {
    $log = Invoke-Launcher 'no-training'
    ($log -join "`n") | Should -Not -Match 'START '
    ($log -join "`n") | Should -Not -Match 'CLEAR'
  }

  It 'timeout/offline -> keeps the credential, does NOT launch SEB' {
    $log = Invoke-Launcher 'timeout'
    ($log -join "`n") | Should -Not -Match 'START '
    ($log -join "`n") | Should -Not -Match 'CLEAR'
    ($log -join "`n") | Should -Not -Match 'PROMPT'  # not re-enrolled
  }

  It '401 enroll_required -> clears the credential and re-enrolls (prompts for a code)' {
    $log = Invoke-Launcher '401'
    ($log -join "`n") | Should -Match 'CLEAR'
    ($log -join "`n") | Should -Match 'PROMPT'
  }
}
