<#
  Each release, on the build PC that holds the certificate (made by new-company-codesign-cert.ps1):

    powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\build-signed-release.ps1 -Thumbprint <THUMBPRINT>

  1. Extracts the two runtime scripts embedded in USAIndiaCFO-Setup.ps1 (UIC-Launch.ps1 and
     UIC-ActivityWatch-Bridge.ps1) to files, so the installer can ship them signed (the setup installs
     these signed copies instead of writing unsigned ones).
  2. Signs all three .ps1 files (SHA-256, timestamped).
  3. If Inno Setup 6 is installed, compiles USAIndiaCFO-Installer.iss; Inno signs the .exe and its
     uninstaller through sign-file.ps1.
  4. Writes SEQRITE-HASHES.txt: publisher, thumbprint and SHA-256 of every file, for the Seqrite admin.
#>
param(
  [Parameter(Mandatory)][string]$Thumbprint,
  [string]$TimestampUrl = 'http://timestamp.digicert.com',
  [string]$Iscc = "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe"
)
$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
$Thumbprint = ($Thumbprint -replace '\s', '').ToUpperInvariant()
$cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My | Where-Object Thumbprint -eq $Thumbprint | Select-Object -First 1
if (-not $cert -or -not $cert.HasPrivateKey) { throw "Code-signing certificate $Thumbprint with its private key is not on this PC." }

function Sign([string]$path) {
  $r = Set-AuthenticodeSignature -FilePath $path -Certificate $cert -TimestampServer $TimestampUrl -HashAlgorithm SHA256
  if ($r.Status -ne 'Valid') { throw "Signing $path failed: $($r.Status) $($r.StatusMessage)" }
  Write-Host "Signed  $path" -ForegroundColor Green
}

# 1. Extract the embedded runtime scripts exactly as the setup would write them.
$setup = Join-Path $PSScriptRoot 'USAIndiaCFO-Setup.ps1'
$existingSig = Get-AuthenticodeSignature $setup
if ($existingSig.SignerCertificate) { throw 'USAIndiaCFO-Setup.ps1 is already signed. Start from the unsigned copy (Git) so the embedded sources are read cleanly.' }
$ast = [Management.Automation.Language.Parser]::ParseFile($setup, [ref]$null, [ref]$null)
$utf8Bom = [Text.UTF8Encoding]::new($true)
foreach ($name in @{ launcherSource = 'UIC-Launch.ps1'; watcherSource = 'UIC-ActivityWatch-Bridge.ps1' }.GetEnumerator()) {
  $assign = $ast.FindAll({ param($n) $n -is [Management.Automation.Language.AssignmentStatementAst] -and
      $n.Left.Extent.Text -eq ('$' + $name.Key) }, $true) | Select-Object -First 1
  if (-not $assign) { throw "Could not find `$$($name.Key) in the setup script." }
  $text = $assign.Right.Expression.Value
  [IO.File]::WriteAllText((Join-Path $PSScriptRoot $name.Value), $text, $utf8Bom)
  Write-Host "Extracted $($name.Value)"
}

# 2. Sign the scripts.
foreach ($f in 'UIC-Launch.ps1', 'UIC-ActivityWatch-Bridge.ps1', 'USAIndiaCFO-Setup.ps1') { Sign (Join-Path $PSScriptRoot $f) }

# 3. Build and sign the installer (optional: needs Inno Setup 6).
$exe = Join-Path $PSScriptRoot 'Output\USAIndiaCFO-Training-Setup.exe'
if (Test-Path $Iscc) {
  # Inno signs the setup .exe and its uninstaller through sign-file.ps1 (no Windows SDK needed).
  $env:UIC_SIGN_THUMBPRINT = $Thumbprint
  $signer = Join-Path $PSScriptRoot 'sign-file.ps1'
  & $Iscc "/Suicsign=powershell.exe -NoProfile -ExecutionPolicy RemoteSigned -File `$q$signer`$q `$f" (Join-Path $PSScriptRoot 'USAIndiaCFO-Installer.iss')
  if ($LASTEXITCODE -ne 0) { throw 'Inno Setup compile failed.' }
  $s = Get-AuthenticodeSignature $exe
  if ($s.Status -ne 'Valid') { throw "Installer signature is $($s.Status)." }
  Write-Host "Signed  $exe" -ForegroundColor Green
} else {
  Write-Host "Inno Setup 6 not found at $Iscc. Scripts are signed; install Inno Setup to also build the .exe." -ForegroundColor Yellow
}

# 4. Hash list for the Seqrite admin.
$files = @('USAIndiaCFO-Setup.ps1', 'UIC-Launch.ps1', 'UIC-ActivityWatch-Bridge.ps1') | ForEach-Object { Join-Path $PSScriptRoot $_ }
if (Test-Path $exe) { $files += $exe }
$lines = @("Publisher: $($cert.Subject)", "Thumbprint: $Thumbprint", "Built: $(Get-Date -Format 'yyyy-MM-dd HH:mm')", '')
foreach ($f in $files) { $lines += '{0}  {1}' -f (Get-FileHash $f -Algorithm SHA256).Hash, (Split-Path -Leaf $f) }
$lines += '', 'Installed on laptops at: %LOCALAPPDATA%\UIC\training\ (UIC-Launch.ps1, UIC-ActivityWatch-Bridge.ps1)'
$lines | Set-Content -Encoding UTF8 (Join-Path $PSScriptRoot 'SEQRITE-HASHES.txt')
$lines | ForEach-Object { Write-Host $_ }
Write-Host "`nSend SEQRITE-HASHES.txt and cert-output\USAIndiaCFO-CodeSigning.cer to the Seqrite admin." -ForegroundColor Cyan
