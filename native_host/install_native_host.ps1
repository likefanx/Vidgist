param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^[a-p]{32}$')]
  [string]$ExtensionId,
  [ValidateSet('Chrome', 'Edge', 'Both')]
  [string]$Browser = 'Both'
)

$ErrorActionPreference = 'Stop'
$hostName = 'com.aicode.vidgist_subtitles'
$launcherSource = Join-Path $PSScriptRoot 'vidgist_native_host_launcher.cs'
$launcherPath = Join-Path $PSScriptRoot 'vidgist_native_host_launcher.exe'
$compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path -LiteralPath $compiler)) { $compiler = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path -LiteralPath $compiler)) { throw 'Windows C# compiler was not found.' }
if (-not (Test-Path -LiteralPath $launcherPath) -or (Get-Item $launcherSource).LastWriteTime -gt (Get-Item $launcherPath).LastWriteTime) {
  & $compiler /nologo /target:exe /out:$launcherPath $launcherSource
  if ($LASTEXITCODE -ne 0) { throw 'Unable to compile Native Messaging launcher.' }
}
$manifestDir = Join-Path $env:LOCALAPPDATA 'VidgistSubtitleBridge'
New-Item -ItemType Directory -Path $manifestDir -Force | Out-Null
$manifestPath = Join-Path $manifestDir "$hostName.json"
@{ name = $hostName; description = 'Local bridge for Vidgist'; path = $launcherPath; type = 'stdio'; allowed_origins = @("chrome-extension://$ExtensionId/") } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$roots = @()
if ($Browser -in @('Chrome', 'Both')) { $roots += 'HKCU:\Software\Google\Chrome\NativeMessagingHosts' }
if ($Browser -in @('Edge', 'Both')) { $roots += 'HKCU:\Software\Microsoft\Edge\NativeMessagingHosts' }
foreach ($root in $roots) { New-Item -Path (Join-Path $root $hostName) -Force | Out-Null; Set-ItemProperty -Path (Join-Path $root $hostName) -Name '(Default)' -Value $manifestPath }
Write-Output "Installed $hostName. Reload Vidgist before invoking vidgist_subtitles.py."
