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
;    powershell -File .\build-signed-release.ps1 -Thumbprint <THUMBPRINT>
;    It signs the scripts, compiles this file, signs the .exe and writes
;    SEQRITE-HASHES.txt for the Seqrite admin.
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
; Signed with the company certificate: build-signed-release.ps1 defines "uicsign" (sign-file.ps1) when it
; runs the compiler. To compile unsigned from the Inno IDE, comment these two lines out.
SignTool=uicsign
SignedUninstaller=yes

[Files]
Source: "USAIndiaCFO-Setup.ps1"; DestDir: "{app}"; Flags: ignoreversion
; Signed runtime scripts produced by build-signed-release.ps1; the setup installs these signed copies.
Source: "UIC-Launch.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "UIC-ActivityWatch-Bridge.ps1"; DestDir: "{app}"; Flags: ignoreversion
; Company certificate (public part) + trust script: the setup trusts the certificate itself, with admin approval.
Source: "trust-company-cert.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "cert-output\USAIndiaCFO-CodeSigning.cer"; DestDir: "{app}"; Flags: ignoreversion
Source: "USAIndiaCFO-Setup-Guide.md"; DestDir: "{app}"; Flags: ignoreversion

[Run]
; PsPath = the native PowerShell: 64-bit on 64-bit Windows (Inno is 32-bit, and 32-bit PowerShell would look
; for SEB under "Program Files (x86)"), the normal one on 32-bit Windows (training without ActivityWatch).
; First a read-only Check, then the real Install. Visible window so the prompts can be answered.
Filename: "{code:PsPath}"; \
  Parameters: "-NoProfile -ExecutionPolicy RemoteSigned -File ""{app}\USAIndiaCFO-Setup.ps1"" -Mode Check"; \
  StatusMsg: "Checking this PC..."; Flags: waituntilterminated
Filename: "{code:PsPath}"; \
  Parameters: "-NoProfile -ExecutionPolicy RemoteSigned -NoExit -File ""{app}\USAIndiaCFO-Setup.ps1"" -Mode Install"; \
  StatusMsg: "Installing training (answer the prompts in the window)..."; Flags: waituntilterminated

[UninstallRun]
; Removes the scheduled training launcher and reporting bridge for this user (the script's own Remove mode).
Filename: "{code:PsPath}"; Parameters: "-NoProfile -ExecutionPolicy RemoteSigned -File ""{app}\USAIndiaCFO-Setup.ps1"" -Mode Remove"; Flags: waituntilterminated; RunOnceId: "UICRemove"

[Code]
function PsPath(Param: String): String;
begin
  if IsWin64 then
    Result := ExpandConstant('{sysnative}\WindowsPowerShell\v1.0\powershell.exe')
  else
    Result := ExpandConstant('{sys}\WindowsPowerShell\v1.0\powershell.exe');
end;
