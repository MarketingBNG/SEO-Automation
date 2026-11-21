# Device setup (Windows) for the activity timesheet

This sets up one employee laptop so the dashboard records their attendance and activity for the
timesheet. Do it once per laptop, with an administrator account, **in the office**. Nothing here is
shown to the employee during the day; they accept the consent screen once in the dashboard, and that
is the disclosure.

Test the whole thing on **one spare laptop first**. The kiosk lock (step 4) can make a laptop hard to
use if it is wrong, so prove it on a spare before any real laptop.

Who gets this: everyone in the training (everyone except the admin). The admin's laptop is not set up.

## What you need first
- The dashboard URL (the Growth Center address).
- Each person's **work token**: in the dashboard as admin, this comes from the Team/worklog token
  action (`POST /api/worklog { action: "token", email }`). Keep each token private; it only lets the
  watcher report that person's activity.

## 1. The employee connects their Zoho (once)
On the laptop, the employee signs into the dashboard and connects their own Zoho from the connect
button (so their timesheet fills under their name). They accept the consent screen once.

## 2. The activity watcher
Copy `uic-watcher.ps1` to the laptop, e.g. `C:\UIC\uic-watcher.ps1`. Test it in a window first:

```
powershell -ExecutionPolicy Bypass -File C:\UIC\uic-watcher.ps1 -Dashboard "https://YOUR-DASHBOARD" -Token "THE-PERSONS-WORK-TOKEN"
```

Leave it a few minutes, then check the dashboard: **Team Training -> Work time** should show that
person's login time and apps. Stop the test window (Ctrl+C).

## 3. Make it run by itself at logon (background)
Register a scheduled task that starts the watcher hidden when the person logs in:

```
$act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-WindowStyle Hidden -ExecutionPolicy Bypass -File C:\UIC\uic-watcher.ps1 -Dashboard "https://YOUR-DASHBOARD" -Token "THE-PERSONS-WORK-TOKEN"'
$trg = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "UIC Watcher" -Action $act -Trigger $trg -RunLevel Limited -Force
```

To stop/remove it later: `Unregister-ScheduledTask -TaskName "UIC Watcher" -Confirm:$false`.

## 4. Kiosk: lock the laptop to only the dashboard (optional, test on a spare first)
This locks the account to a single app. It is the riskiest step. The simplest reversible way is Edge
in kiosk mode at logon:

```
$url = "https://YOUR-DASHBOARD"
$act = New-ScheduledTaskAction -Execute "msedge.exe" -Argument "--kiosk $url --edge-kiosk-type=fullscreen --no-first-run"
$trg = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "UIC Kiosk" -Action $act -Trigger $trg -RunLevel Limited -Force
```

For a stronger lock (no other apps at all), Windows **Assigned Access** (Settings -> Accounts -> Other
users -> Set up a kiosk) ties a local account to one app. Set it up on a **spare** account first and
confirm you can still sign in as admin to undo it. To remove a kiosk task: `Unregister-ScheduledTask
-TaskName "UIC Kiosk" -Confirm:$false`.

## 5. Auto-login
Auto sign-in to Windows is a machine setting (Settings, or `netplwiz`). Combined with step 4, the
laptop opens straight into the dashboard. Keep an administrator account that is NOT auto-login so you
can always get back in.

## Undo everything
- `Unregister-ScheduledTask -TaskName "UIC Watcher" -Confirm:$false`
- `Unregister-ScheduledTask -TaskName "UIC Kiosk" -Confirm:$false`
- Turn off Assigned Access and auto-login in Settings.
