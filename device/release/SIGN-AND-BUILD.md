# USAIndiaCFO Training installer: free company signing + Seqrite trust

This is a free internal certificate. It costs nothing and works on company laptops because IT tells each laptop to trust it. Laptops outside the company will not trust it, and they do not need to.

## Why this is safe
- Only files signed with **your private key** get the trust. The private key stays on one build PC, plus one offline backup. It never goes on a laptop or into email or Git.
- The certificate can **only sign code**. It is not a certificate authority, so it cannot be used to create other certificates.
- Any file someone changes after signing loses its valid signature. Windows then shows it as `HashMismatch`, and the setup refuses to install it.
- A folder exclusion in Seqrite is weaker, because any file placed in that folder would be skipped. Use it only if your Seqrite edition cannot trust a publisher (step D2).

## Files in this folder
| File | Who runs it, and where |
|---|---|
| `new-company-codesign-cert.ps1` | IT, **once**, on the build PC. Creates the certificate. |
| `build-signed-release.ps1` | IT, **every release**, on the build PC. Signs the scripts, builds the signed `.exe` and writes `SEQRITE-HASHES.txt`. |
| `sign-file.ps1` | Used by the build automatically. Do not run it yourself. |
| `trust-company-cert.ps1` | IT, **once per laptop**, as Administrator. Alternatively, push the certificate by Group Policy. |
| `USAIndiaCFO-Installer.iss` | The Inno Setup project the build compiles. |
| `USAIndiaCFO-Setup.ps1` | The setup itself. Keep the **unsigned** copy from Git as the source. |

---

## A. One time: create the certificate (build PC, about 2 minutes)
1. Open **PowerShell** as a normal user (not as admin), in this folder.
2. Run:
   ```powershell
   powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\new-company-codesign-cert.ps1
   ```
3. Choose a strong password when it asks. This password protects the private-key backup.
4. Write down the **Thumbprint** it prints (40 characters). Every later step needs it.
5. It creates `cert-output\`:
   - `USAIndiaCFO-CodeSigning.cer`: the public part. Laptops and Seqrite get this file.
   - `USAIndiaCFO-CodeSigning.pfx`: the private-key backup. Copy it to a USB stick or your password manager, keep it offline, then **delete it from the PC**. Never share it.

## B. Every release: build the signed installer (build PC)
1. Install **Inno Setup 6** once (free: jrsoftware.org/isdl.php).
2. Get a fresh, **unsigned** copy of this folder from Git. The build refuses to run on a setup script that is already signed.
3. Run:
   ```powershell
   powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\build-signed-release.ps1 -Thumbprint <THUMBPRINT>
   ```
4. Every line should say `Signed ...` in green. The output is:
   - `Output\USAIndiaCFO-Training-Setup.exe`: the signed installer you give to employees.
   - `SEQRITE-HASHES.txt`: the publisher, thumbprint and SHA-256 of each file.
5. Check the signature yourself:
   ```powershell
   Get-AuthenticodeSignature .\Output\USAIndiaCFO-Training-Setup.exe | Format-List Status, SignerCertificate
   ```
   `Status` must be `Valid`.

## C. Once per laptop: trust the certificate (now automatic)
The installer now does this itself: when the laptop does not trust the certificate yet, setup asks Windows for admin approval and trusts it, before any prompt. The manual options below are only needed if you prefer to pre-trust laptops (for example by Group Policy).

**Option 1, by hand (Administrator PowerShell).** Copy `trust-company-cert.ps1` and `USAIndiaCFO-CodeSigning.cer` to the laptop, then run:
```powershell
powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\trust-company-cert.ps1 -Thumbprint <THUMBPRINT>
```
It refuses the file if the thumbprint does not match. Run it with `-Remove` to take the trust away again.

**Option 2, Group Policy (domain laptops).** Import the `.cer` into both of these:
- *Computer Configuration > Policies > Windows Settings > Security Settings > Public Key Policies > Trusted Root Certification Authorities*
- *... > Public Key Policies > Trusted Publishers*

## D. Once: Seqrite admin (EPS / Seqrite Centralized Security console)
Send the Seqrite admin `SEQRITE-HASHES.txt` and `USAIndiaCFO-CodeSigning.cer`.
- **D1 (best):** if your edition has a trusted publisher or trusted certificate list (for Application Control or Behavior Detection), add the `.cer` there. Every future signed release is then trusted with no new work.
- **D2 (if D1 is not available):** add the **SHA-256 hashes** from `SEQRITE-HASHES.txt` as exclusions for Behavior Detection and Scan. Optionally, also exclude the folder `%LOCALAPPDATA%\UIC\training\`. Hashes change with every release, so repeat D2 for each new build.
- Push the policy to the employee laptop group.

Seqrite menu names differ by edition and version. If the admin cannot find a publisher option, ask Seqrite support: *"How do I trust a code-signing certificate (publisher) for Behavior Detection in our EPS version?"*

## E. On each employee laptop: install
One installer for every laptop. It detects the Windows type by itself:
- **64-bit Windows:** full setup (training, Safe Exam Browser, Check In, ActivityWatch for the Zoho timesheet).
- **32-bit Windows:** training, Safe Exam Browser and Check In only. ActivityWatch has no 32-bit version, so that laptop's timesheet is not filled automatically.

1. Sign in to the **employee's own Windows account** (not the admin account).
2. Run `USAIndiaCFO-Training-Setup.exe`. Windows shows publisher **USAIndiaCFO Internal Code Signing**.
3. Answer the prompts in the window: consent, work token, SEB recovery password, and the one-time enrollment code from the dashboard's `/seb-code` page.
4. Restart once.

## F. Check that everything works (on the laptop)
Run these in a normal PowerShell window:
```powershell
# 1. Certificate trusted (needs the thumbprint)
Get-ChildItem Cert:\LocalMachine\TrustedPublisher | Where-Object Thumbprint -eq '<THUMBPRINT>'
# 2. Installed scripts signed and Valid
Get-AuthenticodeSignature "$env:LOCALAPPDATA\UIC\training\*.ps1" | Format-Table Status, Path
# 3. Scheduled tasks present
Get-ScheduledTask -TaskName 'UIC *' | Format-Table TaskName, State
# 4. Full health check from the setup itself
powershell -NoProfile -ExecutionPolicy RemoteSigned -File "$env:LOCALAPPDATA\Programs\USAIndiaCFO Training Setup\USAIndiaCFO-Setup.ps1" -Mode Check
```
Expected results: 1 shows one certificate, 2 shows `Valid` for both scripts, 3 shows both `UIC SEB Training ...` and `UIC ActivityWatch Bridge ...`, and 4 ends without errors. If Seqrite still quarantines something, open its quarantine log, note the file name and path, and send them to IT. The cause is usually that step D was not pushed to that laptop yet.

## Check In (Zoho People) and timesheet (Zoho Projects)
- **Employee (once):** in a normal browser, open the dashboard. Under **Zoho connections**, click **Connect** for Zoho People and for Zoho Projects. Each should show a green **Connected**.
- **Zoho admin (once):** the OAuth app has the redirect URIs `https://seo.usaindiacfo.us/api/zoho-people/oauth-callback` and `https://seo.usaindiacfo.us/api/zoho-projects/oauth-callback`.
