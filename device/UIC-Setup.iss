; =============================================================================
;  USAIndiaCFO Device Setup - Inno Setup script
;  Builds a single signed installer (UIC-Device-Setup.exe) that, on install,
;  asks for the employee's work token and runs the all-in-one PowerShell setup
;  (activity watcher + SEB launcher + SEB config + power "always on" + Wi-Fi
;  auto-connect + run-at-logon tasks).
;
;  BUILD (on a Windows machine):
;    1. Install Inno Setup 6:  https://jrsoftware.org/isdl.php
;    2. Put this file next to uic-device-setup.ps1 (same folder).
;    3. To SIGN during build, in Inno Setup IDE: Tools > Configure Sign Tools...
;       add a tool named "uicsign" with a command like:
;         "$p" sign /fd SHA256 /f "C:\path\to\your-cert.pfx" /p PFX_PASSWORD /tr http://timestamp.digicert.com /td SHA256 $f
;       (or /n "Your Company" to use a cert already in the certificate store), then
;       uncomment the SignTool line in [Setup] below.
;    4. Open this .iss in Inno Setup and click Compile. Output: dist\UIC-Device-Setup.exe
;
;  SIGNING NOTE: signing with YOUR company certificate (EV is best for SmartScreen)
;  is the correct way to stop antivirus/SmartScreen warnings - not hiding the tool.
;  Also allowlist the signed .exe in your company antivirus/EDR if needed.
; =============================================================================

#define MyAppName "USAIndiaCFO Device Setup"
#define MyAppVersion "1.0.0"
#define MyPublisher "USAIndiaCFO"
#define Dashboard "https://seo.usaindiacfo.us"

[Setup]
AppId={{B9D4B7E2-7C1E-4D3A-9A1C-5F2E7A1B0C34}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyPublisher}
DefaultDirName={commonpf}\UIC
DisableProgramGroupPage=yes
DisableDirPage=yes
PrivilegesRequired=admin
OutputDir=dist
OutputBaseFilename=UIC-Device-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
UninstallDisplayName={#MyAppName}
; After configuring a sign tool named "uicsign" (see BUILD step 3), uncomment:
; SignTool=uicsign

[Files]
; The all-in-one PowerShell setup is carried inside the installer. It already embeds the activity
; watcher, the SEB launcher and the SEB config, so this one file is all that is needed.
Source: "uic-device-setup.ps1"; DestDir: "{app}"; Flags: ignoreversion

[Code]
var
  TokenPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  TokenPage := CreateInputQueryPage(wpWelcome,
    'Employee work token',
    'Paste this employee''s work token',
    'From the dashboard: Team Training > Device setup > Get token. It identifies this person for both the activity watcher and Safe Exam Browser (no code is ever typed on the device).');
  TokenPage.Add('Work token:', False);
end;

function GetToken(Param: String): String;
begin
  Result := Trim(TokenPage.Values[0]);
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if (CurPageID = TokenPage.ID) and (Trim(TokenPage.Values[0]) = '') then
  begin
    MsgBox('Please paste the work token (from the dashboard Device setup).', mbError, MB_OK);
    Result := False;
  end;
end;

[Run]
; The installer already runs elevated (PrivilegesRequired=admin), so the setup runs with admin rights.
; -SkipTest so the install does not pop SEB open mid-install; the logon task opens it next logon.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy Bypass -File ""{app}\uic-device-setup.ps1"" -Dashboard ""{#Dashboard}"" -Token ""{code:GetToken}"" -SkipTest"; \
  StatusMsg: "Setting up the device (watcher, SEB, power, Wi-Fi, run-at-logon)..."; \
  Flags: waituntilterminated

[UninstallRun]
; Remove the scheduled tasks on uninstall (ignore errors if they are already gone).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy Bypass -Command ""Unregister-ScheduledTask -TaskName 'UIC Watcher' -Confirm:$false -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName 'UIC SEB Launcher' -Confirm:$false -ErrorAction SilentlyContinue"""; Flags: runhidden
