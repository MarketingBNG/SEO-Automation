; =============================================================================
;  USAIndiaCFO Training - one-time installer (Inno Setup 6)
;
;  Wraps the PROVEN USAIndiaCFO-Setup.ps1 (the one that set up the pilot
;  laptop) UNCHANGED. Installing runs it in Install mode in a visible window
;  so the employee/admin can answer its prompts (consent, work token, SEB
;  recovery password, one-time enrollment code). It installs SEB +
;  ActivityWatch (official, checksum-verified), the dashboard bridge and the
;  sign-in/09:00 schedule, exactly as the pilot did.
;
;  Runs as the EMPLOYEE (PrivilegesRequired=lowest), as the guide requires;
;  the script itself asks Windows for admin only for the official SEB install.
;
;  BUILD + SIGN (Windows, once per release) - see SIGN-AND-BUILD.md:
;    1. Sign USAIndiaCFO-Setup.ps1 with the company code-signing certificate
;       (sign-release.ps1 does this).
;    2. Inno Setup: Tools > Configure Sign Tools > add "uicsign" (see .md),
;       then Compile this file. Output: Output\USAIndiaCFO-Training-Setup.exe
;    3. Give the SIGNED .exe's publisher/hash to the Seqrite admin to trust.
; =============================================================================

#define AppName "USAIndiaCFO Training Setup"
#define AppVersion "1.0.0"
#define Publisher "USAIndiaCFO"

[Setup]
AppId={{7E1C4A52-3B9D-4F61-8A2E-5C0D9B7F1A63}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#Publisher}
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\USAIndiaCFO Training Setup
DisableDirPage=yes
DisableProgramGroupPage=yes
OutputDir=Output
OutputBaseFilename=USAIndiaCFO-Training-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
Uninstallable=yes
UninstallDisplayName={#AppName}
; After configuring the sign tool (SIGN-AND-BUILD.md), uncomment both lines:
; SignTool=uicsign
; SignedUninstaller=yes

[Files]
Source: "USAIndiaCFO-Setup.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "USAIndiaCFO-Setup-Guide.md"; DestDir: "{app}"; Flags: ignoreversion

[Run]
; First a read-only Check, then the real Install. Visible window so the prompts can be answered.
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy RemoteSigned -File ""{app}\USAIndiaCFO-Setup.ps1"" -Mode Check"; \
  StatusMsg: "Checking this PC..."; Flags: waituntilterminated
Filename: "powershell.exe"; \
  Parameters: "-NoProfile -ExecutionPolicy RemoteSigned -NoExit -File ""{app}\USAIndiaCFO-Setup.ps1"" -Mode Install"; \
  StatusMsg: "Installing training (answer the prompts in the window)..."; Flags: waituntilterminated

[UninstallRun]
; Removes the scheduled training launcher and reporting bridge for this user (the script's own Remove mode).
Filename: "powershell.exe"; Parameters: "-NoProfile -ExecutionPolicy RemoteSigned -File ""{app}\USAIndiaCFO-Setup.ps1"" -Mode Remove"; Flags: waituntilterminated; RunOnceId: "UICRemove"
