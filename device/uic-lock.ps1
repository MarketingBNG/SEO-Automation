# USAIndiaCFO training lock (Windows, PowerShell 5+). DISCLOSED company-device kiosk.
#
# At logon this covers the screen and keeps the laptop on the training dashboard until today's lesson
# (and the test on test days) is finished. As soon as the person finishes, the whole laptop unlocks for
# the rest of the day. A reboot does not re-lock once the day is done (the dashboard remembers it).
#
# Admin backup: a password box on the lock screen. The correct password unlocks the laptop at once,
# without finishing the lesson. The password is stored here only as a SHA-256 HASH, never in the clear.
#
# While locked, Task Manager is disabled for this user so the lock cannot be killed; it is restored the
# moment the laptop unlocks (and on any exit). The person's Windows account should be a STANDARD
# (non-admin) account, with a separate admin account kept for recovery. Test on a SPARE laptop first.
#
# Run (set up to run at logon, see device/README.md):
#   powershell -ExecutionPolicy Bypass -WindowStyle Hidden -File uic-lock.ps1 -Dashboard "https://YOUR-DASHBOARD" -Token "THE-PERSONS-WORK-TOKEN"

param(
  [string]$Dashboard = $env:UIC_DASHBOARD,
  [string]$Token = $env:UIC_WORK_TOKEN,
  # SHA-256 (hex, upper) of the admin unlock password. Default below is the password you set.
  [string]$PassHash = "7196AF1724F4A3D61E49BEDDE0CE34771AF1E6B97BAB614E0790A2478DCA5982",
  [int]$PollSeconds = 15
)
if (-not $Dashboard -or -not $Token) { Write-Error "Set -Dashboard and -Token."; exit 1 }
$Dashboard = $Dashboard.TrimEnd('/')

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class UicFg {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr h, out int pid);
}
"@

$edge = Join-Path $env:ProgramFiles "Microsoft\Edge\Application\msedge.exe"
if (-not (Test-Path $edge)) { $edge = Join-Path ${env:ProgramFiles(x86)} "Microsoft\Edge\Application\msedge.exe" }

function Set-TaskMgr([bool]$disabled) {
  try {
    New-Item -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Force | Out-Null
    Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Policies\System" -Name DisableTaskMgr -Value ([int]$disabled) -Type DWord
  } catch { }
}

function Start-Lesson {
  if (-not (Test-Path $edge)) { return $null }
  try { return Start-Process -FilePath $edge -PassThru -ArgumentList @("--kiosk","$Dashboard","--edge-kiosk-type=fullscreen","--no-first-run","--disable-features=TranslateUI") } catch { return $null }
}

function Test-Done {
  try {
    $r = Invoke-RestMethod -Uri "$Dashboard/api/worklog/gate" -Method Get -Headers @{ "x-work-token" = $Token } -TimeoutSec 15
    return -not [bool]$r.locked
  } catch { return $false }   # network error: stay locked. The admin password still works.
}

function Get-Hash([string]$s) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  $b = $sha.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($s))
  return ([System.BitConverter]::ToString($b)).Replace("-","").ToUpper()
}

$script:unlock = $false
$script:edgeProc = $null
$script:lastPoll = (Get-Date).AddYears(-1)

$scr = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds

$form = New-Object System.Windows.Forms.Form
$form.FormBorderStyle = 'None'
$form.StartPosition = 'Manual'
$form.Bounds = $scr
$form.TopMost = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(16,18,27)
$form.ShowInTaskbar = $false

$lbl = New-Object System.Windows.Forms.Label
$lbl.Text = "Company training" + [Environment]::NewLine + "Aaj ka lesson poora karein. Lesson complete hote hi laptop khul jayega."
$lbl.ForeColor = [System.Drawing.Color]::White
$lbl.Font = New-Object System.Drawing.Font("Segoe UI",20)
$lbl.TextAlign = 'MiddleCenter'
$lbl.SetBounds(0, [int]($scr.Height*0.28), $scr.Width, 160)
$form.Controls.Add($lbl)

$open = New-Object System.Windows.Forms.Button
$open.Text = "Open today's lesson"
$open.Font = New-Object System.Drawing.Font("Segoe UI",14)
$open.SetBounds([int]($scr.Width/2)-130, [int]($scr.Height*0.28)+180, 260, 56)
$open.Add_Click({ if (-not $script:edgeProc -or $script:edgeProc.HasExited) { $script:edgeProc = Start-Lesson } })
$form.Controls.Add($open)

$hint = New-Object System.Windows.Forms.Label
$hint.Text = "Admin unlock"
$hint.ForeColor = [System.Drawing.Color]::Gray
$hint.Font = New-Object System.Drawing.Font("Segoe UI",9)
$hint.SetBounds([int]($scr.Width/2)-180, $scr.Height-150, 200, 20)
$form.Controls.Add($hint)

$pbox = New-Object System.Windows.Forms.TextBox
$pbox.UseSystemPasswordChar = $true
$pbox.Font = New-Object System.Drawing.Font("Segoe UI",12)
$pbox.SetBounds([int]($scr.Width/2)-180, $scr.Height-125, 240, 30)
$form.Controls.Add($pbox)

$pbtn = New-Object System.Windows.Forms.Button
$pbtn.Text = "Unlock"
$pbtn.Font = New-Object System.Drawing.Font("Segoe UI",12)
$pbtn.SetBounds([int]($scr.Width/2)+70, $scr.Height-126, 110, 32)
$pbtn.Add_Click({
  if ((Get-Hash $pbox.Text) -eq $PassHash.ToUpper()) { $script:unlock = $true }
  else { $pbox.Text = ""; $lbl.Text = "Galat password. Dobara try karein." }
})
$form.Controls.Add($pbtn)

$timer = New-Object System.Windows.Forms.Timer
$timer.Interval = 700
$timer.Add_Tick({
  if ($script:unlock) {
    $timer.Stop()
    try { if ($script:edgeProc -and -not $script:edgeProc.HasExited) { $script:edgeProc.Kill() } } catch { }
    $form.Close(); return
  }
  if (((Get-Date) - $script:lastPoll).TotalSeconds -ge $PollSeconds) {
    $script:lastPoll = Get-Date
    if (Test-Done) { $script:unlock = $true; return }
  }
  $h = [UicFg]::GetForegroundWindow(); $fpid = 0; [void][UicFg]::GetWindowThreadProcessId($h, [ref]$fpid)
  $pname = ""
  try { $pp = Get-Process -Id $fpid -ErrorAction SilentlyContinue; if ($pp) { $pname = $pp.ProcessName } } catch { }
  if ($pname -eq "msedge") {
    $form.Hide()
  } else {
    if (-not $script:edgeProc -or $script:edgeProc.HasExited) { $script:edgeProc = Start-Lesson }
    $form.Show(); $form.TopMost = $true; $form.BringToFront(); $form.Activate()
  }
})

try {
  Set-TaskMgr $true
  $script:edgeProc = Start-Lesson
  $timer.Start()
  [System.Windows.Forms.Application]::Run($form)
} finally {
  # Always restore Task Manager, even if the script crashes.
  Set-TaskMgr $false
}
