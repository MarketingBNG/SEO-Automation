# USAIndiaCFO Training installer — build, sign, and stop Seqrite quarantine

The installer wraps the **proven** `USAIndiaCFO-Setup.ps1` (unchanged from the pilot laptop). Installing it runs Check, then Install, in a visible window for the prompts (consent, work token, SEB recovery password, one-time enrollment code).

## Why Seqrite quarantines, and the only reliable fix
Seqrite's **Behavior Detection** flags *unsigned* PowerShell that installs scheduled tasks and opens a kiosk — the pilot logged `UIC-Watcher.ps1` and an older `UIC-Launch.ps1`. No file can be made "invisible" to antivirus, and hiding it would be wrong. What stops quarantine is:
1. **Sign** the script and the installer with the **company code-signing certificate** (below).
2. Have the **Seqrite admin trust it centrally** (EPS console): add the signed publisher as trusted, or add the file **SHA-256 hashes** and the training folder as an exclusion for Behavior Detection. Do this once; every laptop gets it.

## Build steps (Windows build PC, once per release)
1. Install **Inno Setup 6** (jrsoftware.org/isdl.php).
2. Put these files in one folder: `USAIndiaCFO-Installer.iss`, `USAIndiaCFO-Setup.ps1`, `USAIndiaCFO-Setup-Guide.md`, `sign-release.ps1`.
3. Sign the script:
   `powershell -ExecutionPolicy RemoteSigned -File .\sign-release.ps1 -PfxPath C:\certs\company-codesign.pfx`
   (or `-Thumbprint <thumbprint>` if the cert is in the store). Note the SHA-256 it prints.
4. In Inno Setup: **Tools → Configure Sign Tools → Add**, name `uicsign`, command:
   `"C:\Program Files (x86)\Windows Kits\10\bin\x64\signtool.exe" sign /fd SHA256 /f "C:\certs\company-codesign.pfx" /p $qPFX_PASSWORD$q /tr http://timestamp.digicert.com /td SHA256 $f`
   Then in the `.iss` uncomment `SignTool=uicsign` and `SignedUninstaller=yes`.
5. Open the `.iss` → **Compile**. Output: `Output\USAIndiaCFO-Training-Setup.exe` (signed).
6. Send the Seqrite admin: the `.exe` SHA-256 (`Get-FileHash .\Output\USAIndiaCFO-Training-Setup.exe`), the script SHA-256, the publisher name, and the training folder path. Ask them to trust these for Behavior Detection.

## On each employee laptop
Sign in to the employee's Windows account → run `USAIndiaCFO-Training-Setup.exe` → answer the prompts → restart once → follow the guide's checks (Section 3 and 5). Uninstall (Apps & features) runs the script's `-Mode Remove`.

## Check In (Zoho People) — what each side does
- **Dashboard (fixed in code, 25 Nov):** the check-in was sent with a date format that did not match its value, so Zoho rejected it; it now sends the correct format and the actual time the person pressed Check In.
- **Employee (once):** in their normal browser, dashboard → top **Zoho connections** → **Zoho People → Connect** → shows green **Connected**.
- **Zoho admin (once):** the OAuth app has the redirect URIs `https://seo.usaindiacfo.us/api/zoho-people/oauth-callback` and `https://seo.usaindiacfo.us/api/zoho-projects/oauth-callback`; scope `ZOHOPEOPLE.attendance.ALL` is allowed; the Zoho People plan includes the Attendance API; the employee has permission to check in to their own attendance.
