# USAIndiaCFO training: remove EVERYTHING from this laptop (all Windows users), for a clean reinstall.
# Run in PowerShell opened with "Run as administrator". Does NOT touch certificates, C:\UIC-Build or Downloads.
& {
  if (-not ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { Write-Host 'Open PowerShell with "Run as administrator" and paste again.' -ForegroundColor Red; return }
  $ErrorActionPreference = 'SilentlyContinue'
  Write-Host 'Removing USAIndiaCFO training setup...' -ForegroundColor Cyan
  # 1. Stop running parts
  Get-Process SafeExamBrowser*, aw-qt, aw-server*, aw-watcher-* | Stop-Process -Force
  # 2. Scheduled tasks of every user (UIC SEB Training, UIC ActivityWatch Bridge, old UIC Activity Watcher)
  Get-ScheduledTask | Where-Object TaskName -like 'UIC *' | ForEach-Object { Stop-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath; Unregister-ScheduledTask -TaskName $_.TaskName -TaskPath $_.TaskPath -Confirm:$false; Write-Host "Removed task: $($_.TaskName)" }
  # 3. Safe Exam Browser (official uninstaller, silent)
  $uninst = 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*'
  Get-ItemProperty $uninst | Where-Object DisplayName -like 'Safe Exam Browser*' | ForEach-Object {
    Write-Host "Uninstalling $($_.DisplayName) $($_.DisplayVersion)..."
    if ($_.QuietUninstallString) { cmd /c $_.QuietUninstallString }
    elseif ($_.UninstallString -match 'msiexec' -and $_.UninstallString -match '\{[0-9A-Fa-f-]{36}\}') { Start-Process msiexec.exe -ArgumentList "/x $($Matches[0]) /qn /norestart" -Wait }
    elseif ($_.UninstallString) { cmd /c "$($_.UninstallString) /uninstall /quiet /norestart" }
  }
  # 3b. ActivityWatch installed anywhere (machine-wide, or per-user for signed-in users): official uninstaller, silent
  $awKeys = @('HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\*', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*') +
            @(Get-ChildItem Registry::HKEY_USERS | ForEach-Object { "Registry::$($_.Name)\Software\Microsoft\Windows\CurrentVersion\Uninstall\*" })
  Get-ItemProperty $awKeys | Where-Object DisplayName -like 'ActivityWatch*' | ForEach-Object {
    Write-Host "Uninstalling $($_.DisplayName)..."
    $exe = ($_.UninstallString -replace '"', '').Trim()
    if ($exe -and (Test-Path -LiteralPath $exe)) { Start-Process -FilePath $exe -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART' -Wait }
    Remove-Item -LiteralPath $_.PSPath -Recurse -Force
  }
  foreach ($t in "$env:ProgramFiles\ActivityWatch", "${env:ProgramFiles(x86)}\ActivityWatch") {
    if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Recurse -Force; Write-Host "Deleted: $t" }
  }
  # 4. Files in every user profile: training scripts, enrollment, setup copy, ActivityWatch app + data, SEB logs
  $profiles = Get-CimInstance Win32_UserProfile | Where-Object { -not $_.Special -and $_.LocalPath } | ForEach-Object LocalPath
  foreach ($prof in $profiles) {
    foreach ($rel in 'AppData\Local\UIC', 'AppData\Local\Programs\USAIndiaCFO Training Setup', 'AppData\Local\Programs\ActivityWatch', 'AppData\Local\activitywatch',
                     'AppData\Local\SafeExamBrowser', 'AppData\Roaming\SafeExamBrowser',
                     'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup\ActivityWatch.lnk', 'AppData\Roaming\Microsoft\Windows\Start Menu\Programs\ActivityWatch') {
      $t = Join-Path $prof $rel
      if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Recurse -Force; Write-Host "Deleted: $t" }
    }
    # Old setup files from earlier attempts (Downloads only; the Desktop is left alone)
    Get-ChildItem -LiteralPath (Join-Path $prof 'Downloads') -File | Where-Object {
      $_.Name -like 'USAIndiaCFO-Setup*' -or $_.Name -like 'USAIndiaCFO-Installer*' -or $_.Name -like 'USAIndiaCFO-Training-Setup*' -or
      $_.Name -like 'UIC-*.ps1*' -or $_.Name -like 'UIC-*.cmd*' -or $_.Name -like 'uic-*.ps1*' -or $_.Name -like 'UIC-Setup*' -or $_.Name -like 'UIC-Verify*'
    } | ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force; Write-Host "Deleted: $($_.FullName)" }
  }
  # 5. Machine-wide leftovers
  foreach ($t in "$env:ProgramData\UIC", "$env:ProgramData\SafeExamBrowser", "$env:ProgramFiles\SafeExamBrowser", 'C:\UIC-Install') {
    if (Test-Path -LiteralPath $t) { Remove-Item -LiteralPath $t -Recurse -Force; Write-Host "Deleted: $t" }
  }
  # 6. "Apps & features" entry and ActivityWatch autostart for signed-in users
  Get-ChildItem Registry::HKEY_USERS | ForEach-Object {
    Remove-Item -LiteralPath "Registry::$($_.Name)\Software\Microsoft\Windows\CurrentVersion\Uninstall\{7E1C4A52-3B9D-4F61-8A2E-5C0D9B7F1A63}_is1" -Recurse -Force
    Remove-ItemProperty -LiteralPath "Registry::$($_.Name)\Software\Microsoft\Windows\CurrentVersion\Run" -Name ActivityWatch -Force
  }
  # 7. Report
  $left = @(Get-ScheduledTask | Where-Object TaskName -like 'UIC *').Count
  $seb = Test-Path "$env:ProgramFiles\SafeExamBrowser\Application\SafeExamBrowser.exe"
  Write-Host ''
  $aw = @(Get-Process aw-qt, aw-server*).Count -gt 0
  if ($left -eq 0 -and -not $seb -and -not $aw) { Write-Host 'Done. Everything removed. Restart the laptop, then install the new version.' -ForegroundColor Green }
  else { Write-Host "Something is left (UIC tasks: $left, SEB still installed: $seb, ActivityWatch running: $aw). Restart and run this again." -ForegroundColor Yellow }
}
