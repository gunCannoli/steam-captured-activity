<#
.SYNOPSIS
  Builds uwp_presenter into steam-cartridges-third-party/bin/uwp_presenter.exe
#>
[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$outDir = Join-Path $PSScriptRoot '..\..\bin'
Write-Host "Publishing uwp_presenter to $outDir..." -ForegroundColor Cyan

& dotnet publish "$PSScriptRoot\uwp_presenter.csproj" -c Release -r win-x64 --self-contained true -p:PublishSingleFile=true -o $outDir
if ($LASTEXITCODE -ne 0) {
    throw "dotnet publish failed with exit code $LASTEXITCODE"
}
Write-Host "Built uwp_presenter.exe successfully." -ForegroundColor Green
