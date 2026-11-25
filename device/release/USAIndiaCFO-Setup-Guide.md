# USAIndiaCFO training and timesheet setup

**Pilot status, 25 November 2026 IST.** The Windows Enterprise VM QA test closed Safe Exam Browser (SEB) without a password. On Krati’s Windows 11 Home PC, the revised launcher opened SEB with Seqrite active, and the ActivityWatch bridge delivered activity reports accepted by the dashboard. Zoho People and Projects both show **Connected**. Zoho People shows a 10:36 AM check-in. Its source still needs verification. For the automatic Projects test, check the 25 November work date after a successful training finish on 26 November IST or later and the subsequent server sync. Complete the Home sign-off below before deploying to other employees.

## 1. Send this to your Zoho admin

> Please confirm our current Zoho plan supports People attendance check-in and Projects time logging through the API at no extra cost. Please confirm the account data center, the Projects portal ID, each team's project ID, and the email of one test employee whose records we can use for verification.
>
> In Zoho API Console, open the existing server-based OAuth application for the USAIndiaCFO dashboard. Add both authorized redirect URLs below. Keep any existing redirect URLs. Please confirm the test employee can check in to their own attendance record in Zoho People and add time to their own team's Projects timesheet. Please make a `General` task available in the test project.
>
> If the dashboard team needs the OAuth client ID or client secret, share them through our approved secret-sharing channel. Please keep the client secret out of chat and off employee laptops.

- People callback — `https://seo.usaindiacfo.us/api/zoho-people/oauth-callback`
- Projects callback — `https://seo.usaindiacfo.us/api/zoho-projects/oauth-callback`

[Register a Zoho OAuth app](https://www.zoho.com/developer/oauth/register-app.html) · [People attendance API](https://www.zoho.com/people/api/attendance-checkin-checkout.html) · [Projects API and scopes](https://projects.zoho.com/api-docs)

## 2. Have your dashboard admin finish the server setup

1. Set `ZOHO_PEOPLE_REDIRECT_URI` and `ZOHO_PROJECTS_REDIRECT_URI` in Coolify to the exact URLs above. Confirm that `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, and `ZOHO_ACCOUNTS_URL` match the existing OAuth client and its data center. Confirm `ZOHO_PEOPLE_API_URL`, `ZOHO_PROJECTS_API_URL`, `ZOHO_PROJECTS_PORTAL`, and the team project mappings. For the current Marketing and Automation mappings, the code reads `ZOHO_PROJECT_MARKETING` and `ZOHO_PROJECT_AUTOMATION`.
2. Verify the dashboard can request People scope `ZOHOPEOPLE.attendance.ALL` and the existing Projects scopes `ZohoProjects.portals.READ`, `ZohoProjects.projects.READ`, `ZohoProjects.tasks.ALL`, and `ZohoProjects.timesheets.ALL`. Use the test employee's own permissions when checking both integrations. [Zoho People OAuth scopes](https://www.zoho.com/people/api/v3/scopes.html) · [Zoho Projects OAuth scopes](https://projects.zoho.com/api-docs)
3. Match the dashboard setting `seb_quit_url` or the `SEB_QUIT_URL` environment variable to the exact quit URL in the release SEB profile. Check that **Finished** saves the lesson or test before the dashboard sends the quit URL.
4. Configure the existing Coolify scheduler to call `GET /api/cron/timesheet-sync` on the dashboard with `Authorization: Bearer <CRON_SECRET>`. Keep `CRON_SECRET` on the server.
5. For the pilot, have the test employee open the dashboard in their regular browser and connect **Zoho People** and **Zoho Projects** once with their own accounts. The former records **Check In**. The latter receives hours for prior worked dates. If People access is unavailable, keep the feature pending and confirm plan coverage before paying for anything.

**Check the time recorded in Zoho.** The reviewed People integration submits **09:00** for the selected date. If you expect Zoho to show the actual time the employee clicked **Check In**, the dashboard team needs to change that field and test it before rollout.

## 3. Set up each employee laptop after the Home pilot

1. Sign into the company Windows account that the employee will use. Keep the separate Windows administrator account available for the SEB installation prompt and recovery.
2. Have the employee accept the dashboard's attendance and app-usage disclosure. In their regular browser, have them connect Zoho once. Day-to-day check-out is manual in Zoho People on the phone or browser.
3. As dashboard admin, open **Team Training → Work time → Device setup → Get token** for that employee. Use separate work tokens for separate employee accounts. Rotate any token previously shared in chat.
4. Save `USAIndiaCFO-Setup.ps1` to **Downloads**. Open PowerShell under the employee's Windows account and run this one command:

   ```powershell
   powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File "$env:USERPROFILE\Downloads\USAIndiaCFO-Setup.ps1" -Mode Install
   ```

5. Follow the prompts for consent, the employee work token, the admin SEB recovery password, and a one-time enrollment code taken from the employee's **SEB code** page. At the private work-token prompt, paste either the token or the full command shown in **Device setup**. Setup extracts the token and checks it with the dashboard. Get the enrollment code when prompted because it expires quickly. If Windows asks for elevation, the administrator approves the official SEB installer. Keep the recovery password in the company password vault.
6. Setup installs ActivityWatch, starts the dashboard bridge, and schedules SEB to check at Windows sign-in and at 09:00 IST. Save open work and restart once, then sign in to the same employee account. Verify ActivityWatch starts and a fresh `activity accepted` line appears in `%LOCALAPPDATA%\UIC\training\ACTIVITYWATCH.log`. The employee's enrollment and work token are stored with Windows DPAPI under their own Windows account. Future launches reuse enrollment.

You can use `-Mode Check` instead of `-Mode Install` for a read-only check. For recovery, use `-Mode Remove` to remove the scheduled training launcher and reporting bridge for the current user. To stop ActivityWatch local collection, quit ActivityWatch and turn off **Start at login** in its tray menu. The saved enrollment remains available.

## 4. If Seqrite blocks a file

The Home pilot recorded two Behavior Detection events. Both files were under `%LOCALAPPDATA%\UIC\training`.

| Detected file | What it affected | Pilot evidence |
| --- | --- | --- |
| `UIC-Watcher.ps1` | Legacy activity reporting | Quarantined on 23 November at 9:49:47 PM IST, report `LG2189.dat`. ActivityWatch and `UIC-ActivityWatch-Bridge.ps1` replace this watcher. |
| `UIC-Launch.ps1` | SEB opening when training is pending | An earlier launcher was quarantined on 24 November at 10:26:45 AM IST, report `LG64E5.dat`. The revised launcher later opened SEB with Seqrite active on the pilot PC. |

1. If training fails to open, check `SEB-STARTUP.log` in the training folder. If activity fails to appear after using a work app, check `ACTIVITYWATCH.log` for a fresh **activity accepted** entry. In Task Scheduler, look for **UIC SEB Training** and **UIC ActivityWatch Bridge** with the employee's Windows SID at the end of each name.
2. If a file is missing, check Quarantine Management and the local Seqrite detection history for the exact file and time. A **Restored Successfully** timestamp records a restore. Confirm a second detection against its own event time. If a file is still present, record its SHA-256 and compare it with the approved copy. If the file is missing, use the detection record's hash and note the algorithm.
3. Keep Seqrite enabled. If the current launcher, bridge, or vendor installer is flagged, record the endpoint, exact path, hash, policy status, and detection name. Send the incident details to the endpoint admin or Seqrite Support for review. Retry after the approved build is available, then check for a new SEB launch or dashboard acknowledgment.

## 5. Sign off before deploying to other devices

| Test | Passing result |
| --- | --- |
| 09:00 IST and restart | An already signed-in trainee is gated at 09:00. An enrolled trainee who signs in later sees the pending item without a new code. Before 09:00, on days with no assigned training, and during a dashboard connection failure, the desktop stays available according to the gate rules. |
| Finished and recovery | Use a disposable lesson or test. Confirm **Finished** returns to the desktop, a same-day restart stays unlocked, and admin recovery exits SEB while leaving a pending item pending. |
| Kiosk and load | Open an ordinary folder before launch. Verify it cannot be reached while SEB is active. Record time from sign-in to the lesson and CPU/RAM on the actual Windows edition being approved. |
| Activity watcher | The dashboard accepts reports after Windows sign-in and the watcher stops on sign-out or shutdown. |
| Zoho People | Clicking **Check In** on the training screen records one punch under the test employee, including the intended check-in time. A retry adds no duplicate. Manual check-out appears in Zoho People. |
| Zoho Projects | Use a genuine prior worked date for an approved test account. After a later day's successful training completion and server sync, verify one time entry with the original worked date under **General** in the mapped test project. Check again after a subsequent sync for duplicates. For example, Friday hours can post after Saturday's training if training is scheduled that day. |

The first release is ready for employee laptops once these checks pass in a licensed Windows Home test environment. Keep the VM package and rollout installer available so a failed device can be recovered.

## 6. Prompt for Codex on another approved company PC

> Set up USAIndiaCFO training on this company PC using the attached USAIndiaCFO-Setup.ps1 and setup guide. Confirm I am signed into the employee’s Windows account. Run the script in Check mode first. Proceed with Install mode only after the Windows Home pilot has passed and the employee has consented. Let me enter the employee's work token, enrollment code, and recovery password directly into the setup prompts. After a restart, verify SEB and the ActivityWatch bridge tasks, then look for a fresh dashboard acceptance in ACTIVITYWATCH.log. Keep Seqrite enabled and use the guide to identify any blocked file. Verify Zoho People and Projects are connected under the employee's account. Use only an assigned disposable QA item for the Finished test and a genuine prior worked date for timesheet verification. Keep Windows and the existing Zoho plan at their current editions. Report what passed and what remains pending.
