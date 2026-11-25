<#
  On EACH employee laptop, ONCE, as ADMINISTRATOR (or push the same two stores by Group Policy/Intune):

    powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\trust-company-cert.ps1 -Thumbprint <THUMBPRINT>

  Makes Windows trust files signed with the USAIndiaCFO internal code-signing certificate, for every
  user on the laptop. Only the public .cer is used; no private key ever goes on a laptop.
  -Thumbprint is required and is checked against the .cer, so a swapped or wrong file is refused.
  -Remove takes the trust away again.
#>
param(
  [Parameter(Mandatory)][string]$Thumbprint,
  [string]$CerPath = (Join-Path $PSScriptRoot 'USAIndiaCFO-CodeSigning.cer'),
  [switch]$Remove
)
$ErrorActionPreference = 'Stop'
$Thumbprint = ($Thumbprint -replace '\s', '').ToUpperInvariant()

$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $admin) { throw 'Run this in PowerShell opened with "Run as administrator".' }

$stores = 'Cert:\LocalMachine\Root', 'Cert:\LocalMachine\TrustedPublisher'
if ($Remove) {
  foreach ($s in $stores) { Get-ChildItem $s | Where-Object Thumbprint -eq $Thumbprint | Remove-Item }
  Write-Host 'Company certificate trust removed.' -ForegroundColor Yellow
  return
}

$cert = [Security.Cryptography.X509Certificates.X509Certificate2]::new($CerPath)
if ($cert.Thumbprint -ne $Thumbprint) { throw "The .cer thumbprint is $($cert.Thumbprint), expected $Thumbprint. Wrong file; not trusting it." }
if ($cert.HasPrivateKey) { throw 'This file contains a private key. Use the public .cer only.' }
$eku = $cert.Extensions | Where-Object { $_ -is [Security.Cryptography.X509Certificates.X509EnhancedKeyUsageExtension] } |
  ForEach-Object { $_.EnhancedKeyUsages | ForEach-Object Value }
if ($eku -notcontains '1.3.6.1.5.5.7.3.3') { throw 'This is not a code-signing certificate.' }

foreach ($s in $stores) { Import-Certificate -FilePath $CerPath -CertStoreLocation $s | Out-Null }
Write-Host "Trusted on this laptop: $($cert.Subject) ($Thumbprint), expires $($cert.NotAfter)" -ForegroundColor Green
