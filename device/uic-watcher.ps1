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
