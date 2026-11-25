<#
  ONE TIME, on ONE admin/build PC: create the free internal USAIndiaCFO code-signing certificate.

    powershell -NoProfile -ExecutionPolicy RemoteSigned -File .\new-company-codesign-cert.ps1

  Creates a self-signed certificate that can ONLY sign code (EKU Code Signing, not a CA, so it cannot
  issue other certificates). The private key stays in this PC's personal store (Cert:\CurrentUser\My).
  Writes, in .\cert-output\:
    USAIndiaCFO-CodeSigning.cer   public part: give this to every laptop (trust-company-cert.ps1) and Seqrite
    USAIndiaCFO-CodeSigning.pfx   private key BACKUP, password protected: keep offline (USB in a safe /
                                  password manager). Never email it, never put it on a laptop or in Git.
  Prints the thumbprint: you need it for build-signed-release.ps1 and trust-company-cert.ps1.
#>
param(
  [string]$Subject = 'CN=USAIndiaCFO Internal Code Signing, O=USAIndiaCFO',
  [int]$Years = 5,
  [string]$OutDir = (Join-Path $PSScriptRoot 'cert-output')
)
$ErrorActionPreference = 'Stop'

$existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -eq $Subject -and $_.NotAfter -gt (Get-Date) }
if ($existing) {
  Write-Host "A valid certificate already exists: $($existing[0].Thumbprint) (expires $($existing[0].NotAfter)). Not creating another." -ForegroundColor Yellow
  return
}

$cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $Subject `
  -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 -KeyUsage DigitalSignature `
  -KeyExportPolicy Exportable -CertStoreLocation Cert:\CurrentUser\My `
  -NotAfter (Get-Date).AddYears($Years) `
  -TextExtension @('2.5.29.19={critical}{text}ca=0')   # not a CA: cannot issue other certificates

[void](New-Item -ItemType Directory -Force -Path $OutDir)
$cer = Join-Path $OutDir 'USAIndiaCFO-CodeSigning.cer'
$pfx = Join-Path $OutDir 'USAIndiaCFO-CodeSigning.pfx'
Export-Certificate -Cert $cert -FilePath $cer | Out-Null
$pw = Read-Host 'Choose a strong password for the private-key backup (.pfx)' -AsSecureString
Export-PfxCertificate -Cert $cert -FilePath $pfx -Password $pw | Out-Null

# This PC must trust it too, or signing works but verification here says "UnknownError".
# Windows shows a security prompt for the Root import: check the thumbprint matches and click Yes.
foreach ($store in 'Root', 'TrustedPublisher') {
  Import-Certificate -FilePath $cer -CertStoreLocation "Cert:\CurrentUser\$store" | Out-Null
}

Write-Host ''
Write-Host "Created:    $($cert.Subject)" -ForegroundColor Green
Write-Host "Thumbprint: $($cert.Thumbprint)" -ForegroundColor Green
Write-Host "Expires:    $($cert.NotAfter)"
Write-Host "Public cert (for laptops + Seqrite): $cer"
Write-Host "Private key backup (keep offline!):  $pfx"
