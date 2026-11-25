<#
  Sign USAIndiaCFO-Setup.ps1 with the company code-signing certificate before building the installer.
  Run on the build PC (Windows PowerShell), in this folder:
    powershell -ExecutionPolicy RemoteSigned -File .\sign-release.ps1 -PfxPath C:\certs\company-codesign.pfx
  or, if the certificate is already in your certificate store:
    powershell -ExecutionPolicy RemoteSigned -File .\sign-release.ps1 -Thumbprint <cert-thumbprint>
  It prints the SHA-256 of the signed script - give that (and the signed .exe's hash) to the Seqrite admin.
#>
param([string]$PfxPath, [string]$Thumbprint, [string]$TimestampUrl = 'http://timestamp.digicert.com')
$ErrorActionPreference = 'Stop'
$file = Join-Path $PSScriptRoot 'USAIndiaCFO-Setup.ps1'
if ($PfxPath) {
  $pw = Read-Host 'PFX password' -AsSecureString
  $cert = Get-PfxCertificate -FilePath $PfxPath -Password $pw
} elseif ($Thumbprint) {
  $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My | Where-Object Thumbprint -eq $Thumbprint | Select-Object -First 1
} else { throw 'Pass -PfxPath or -Thumbprint.' }
if (-not $cert -or -not $cert.HasPrivateKey) { throw 'Code-signing certificate with a private key not found.' }
$r = Set-AuthenticodeSignature -FilePath $file -Certificate $cert -TimestampServer $TimestampUrl -HashAlgorithm SHA256
if ($r.Status -ne 'Valid') { throw "Signing failed: $($r.StatusMessage)" }
Write-Host "Signed: $file  ($($r.SignerCertificate.Subject))"
Write-Host ("SHA-256: " + (Get-FileHash $file -Algorithm SHA256).Hash)
