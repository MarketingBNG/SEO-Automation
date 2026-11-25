<#
  Helper used by Inno Setup (build-signed-release.ps1 passes it as the "uicsign" sign tool) to sign the
  installer .exe and its uninstaller with the company certificate. Not run by hand.
  Needs the env var UIC_SIGN_THUMBPRINT (build-signed-release.ps1 sets it).
#>
param([Parameter(Mandatory)][string]$Path)
$ErrorActionPreference = 'Stop'
$tp = $env:UIC_SIGN_THUMBPRINT
$cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My | Where-Object Thumbprint -eq $tp | Select-Object -First 1
if (-not $cert -or -not $cert.HasPrivateKey) { Write-Error "Signing certificate $tp not found."; exit 1 }
$r = Set-AuthenticodeSignature -FilePath $Path -Certificate $cert -TimestampServer 'http://timestamp.digicert.com' -HashAlgorithm SHA256
if ($r.Status -ne 'Valid') { Write-Error "Signing failed: $($r.Status) $($r.StatusMessage)"; exit 1 }
exit 0
