[CmdletBinding(SupportsShouldProcess=$true)]
param()
$ErrorActionPreference = 'Stop'
$state = Get-Content -LiteralPath (Join-Path $PSScriptRoot 'install-state.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ([IO.Path]::GetFullPath($state.InstallRoot) -ne [IO.Path]::GetFullPath($PSScriptRoot)) { throw '状态文件与安装目录不匹配。' }
foreach ($entry in $state.Files) {
    if ($entry.Name -notin @('package.json','cordis.patch.yml') -or [IO.Path]::GetFullPath($entry.Path) -ne [IO.Path]::GetFullPath((Join-Path $state.ProfilePath $entry.Name))) { throw '备份目标路径异常。' }
    if ($entry.InstalledHash -and (Test-Path -LiteralPath $entry.Path) -and (Get-FileHash -LiteralPath $entry.Path -Algorithm SHA256).Hash -ne $entry.InstalledHash) { throw "安装后配置已被修改，保留现场，请人工合并备份：$($entry.Path)" }
}
$expectedModule = Join-Path $state.ProfilePath 'node_modules\@wxg-prc-cpg\browser-skill-dsh-plugin'
if ([IO.Path]::GetFullPath($state.ModuleLink) -ne [IO.Path]::GetFullPath($expectedModule)) { throw '模块链接路径异常。' }
$link = Get-Item -LiteralPath $state.ModuleLink -Force -ErrorAction SilentlyContinue
$expectedTarget = Join-Path $PSScriptRoot 'offline\node_modules\@wxg-prc-cpg\browser-skill-dsh-plugin'
if ($link -and (!(($link.Attributes -band [IO.FileAttributes]::ReparsePoint)) -or [IO.Path]::GetFullPath([string]$link.Target) -ne [IO.Path]::GetFullPath($expectedTarget))) { throw '模块目录已改动或属于其他部署，保留现场。' }
if (!$PSCmdlet.ShouldProcess($state.ProfilePath,'恢复原配置并停用本安装的后台任务')) { return }
$task = Get-ScheduledTask -TaskName $state.TaskName -ErrorAction SilentlyContinue
$expected = Join-Path $PSScriptRoot 'run-daemon.ps1'
if ($task) {
    if (!(($task.Actions | ForEach-Object { $_.Arguments }) -join ' ').Contains($expected)) { throw '同名任务属于其他部署，不进行修改。' }
    Disable-ScheduledTask -TaskName $state.TaskName | Out-Null
    Stop-ScheduledTask -TaskName $state.TaskName
    Unregister-ScheduledTask -TaskName $state.TaskName -Confirm:$false
}
foreach ($entry in $state.Files) {
    if ($entry.Existed) { Copy-Item -LiteralPath (Join-Path $PSScriptRoot "install-backup\$($entry.Name)") -Destination $entry.Path -Force }
    elseif (Test-Path -LiteralPath $entry.Path) { Remove-Item -LiteralPath $entry.Path }
}
if ($link -and ($link.Attributes -band [IO.FileAttributes]::ReparsePoint) -and [IO.Path]::GetFullPath([string]$link.Target) -eq [IO.Path]::GetFullPath($expectedTarget)) { [IO.Directory]::Delete($state.ModuleLink) }
Write-Host '原配置已恢复，模块目录链接已解除。请在 Edge 停用扩展后重开 Harness。安装文件和备份保留，未删除个人资料，也未结束浏览器。'
