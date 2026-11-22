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

## 4. The lock gate (lesson lock), reversible, test on a spare first
`uic-gate.ps1` polls the dashboard. While today's training is not done (and it is after 09:00 IST) it
holds the laptop in a fullscreen Edge kiosk on the dashboard, so only the lesson is usable. As soon as
the lesson/test is done the kiosk closes and the laptop is free for the rest of the day; a reboot does
not re-lock (the dashboard remembers the day is done). It only opens and closes an Edge window and
changes no Windows policy, so it is safe and reversible. It fails open: on a network error it does not
lock.

Copy `uic-gate.ps1` to `C:\UIC\uic-gate.ps1`. Test it in a window first (sign in to the dashboard in
the kiosk, then do or skip today's lesson to watch it lock and free):

```
powershell -ExecutionPolicy Bypass -File C:\UIC\uic-gate.ps1 -Dashboard "https://YOUR-DASHBOARD" -Token "THE-PERSONS-WORK-TOKEN"
```

Run it at logon:

```
$act = New-ScheduledTaskAction -Execute "powershell.exe" -Argument '-WindowStyle Hidden -ExecutionPolicy Bypass -File C:\UIC\uic-gate.ps1 -Dashboard "https://YOUR-DASHBOARD" -Token "THE-PERSONS-WORK-TOKEN"'
$trg = New-ScheduledTaskTrigger -AtLogOn
Register-ScheduledTask -TaskName "UIC Gate" -Action $act -Trigger $trg -RunLevel Limited -Force
```

To stop it: `Unregister-ScheduledTask -TaskName "UIC Gate" -Confirm:$false`.

For a **hard** lock (no other app can run at all, not just a kiosk window), Windows **Assigned Access**
ties a local account to one app. It is the riskiest option: set it up on a **spare** account first and
keep a separate admin account that can always sign in to undo it. Do this only after the reversible
gate above is proven.

## 5. Auto-login
Auto sign-in to Windows is a machine setting (Settings, or `netplwiz`). Combined with step 4, the
laptop opens straight into the dashboard. Keep an administrator account that is NOT auto-login so you
can always get back in.

## Undo everything
- `Unregister-ScheduledTask -TaskName "UIC Watcher" -Confirm:$false`
- `Unregister-ScheduledTask -TaskName "UIC Kiosk" -Confirm:$false`
- Turn off Assigned Access and auto-login in Settings.

## SEB enrollment launcher (one-time code, then silent)
`uic-seb-launcher.ps1` replaces typing a code every day. First run: enter the one-time code from
`/seb-code` (regular browser); the launcher links this employee to this Windows user, stores a revocable
credential with DPAPI (per Windows user), and opens SEB. Later runs/reboots exchange the stored
credential silently for a fresh single-use code and open SEB — no code needed. A code is asked again only
if the enrollment is revoked (admin, `/api/seb/admin`), the credential is wrong, or a different Windows
user signs in. DEVICE-SIDE and NOT tested on Windows here; test on a spare/VM. The durable credential
never appears in a URL; SEB only ever receives a fresh single-use code in the URL fragment.
