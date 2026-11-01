[CmdletBinding(SupportsShouldProcess=$true)]
param([string]$InstallRoot='D:\DeepSeek浏览器助手', [string]$ProfilePath, [string]$TaskName='DSH Edge BrowserSkill')
$ErrorActionPreference = 'Stop'
$sourceRoot = $PSScriptRoot
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot)
if ($InstallRoot.StartsWith('\\')) { throw '请选择本机磁盘路径。' }
if ($InstallRoot.StartsWith(([IO.Path]::GetFullPath($sourceRoot) + '\'),[StringComparison]::OrdinalIgnoreCase)) { throw '安装目录必须位于解压目录之外。' }
if (!$ProfilePath) {
    $profiles = Join-Path $env:USERPROFILE '.dsh\profiles'
    $preferred = Join-Path $profiles 'tauri'
    if (Test-Path -LiteralPath (Join-Path $preferred 'package.json')) { $ProfilePath = $preferred }
    else {
        $candidates = @(Get-ChildItem -LiteralPath $profiles -Directory | Where-Object { Test-Path -LiteralPath (Join-Path $_.FullName 'package.json') })
        if ($candidates.Count -ne 1) { throw '请先运行 Harness；多个配置时用 -ProfilePath 指定目标配置目录。' }
        $ProfilePath = $candidates[0].FullName
    }
}
$ProfilePath = [IO.Path]::GetFullPath($ProfilePath)
if (!(Test-Path -LiteralPath (Join-Path $ProfilePath 'package.json'))) { throw '目标不是已初始化的 Harness 配置。' }
if (Test-Path -LiteralPath $InstallRoot) { throw '安装目录已存在，请选择新的 -InstallRoot；不会覆盖现有部署。' }
$module = Join-Path $ProfilePath 'node_modules\@wxg-prc-cpg\browser-skill-dsh-plugin'
if (Test-Path -LiteralPath $module) { throw '此配置已有 BrowserSkill；请保留现有部署或选择另一配置，避免覆盖。' }
$taskName = $TaskName
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) { throw '已存在同名后台任务；不会覆盖现有部署。' }
& (Join-Path $sourceRoot 'runtime\node.exe') (Join-Path $sourceRoot 'Verify-Package.mjs')
if ($LASTEXITCODE -ne 0) { throw '迁移包校验失败。' }
if (!$PSCmdlet.ShouldProcess("$InstallRoot -> $ProfilePath", '安装浏览器助手及当前用户后台任务')) { return }
if (Get-Process -Name 'deepseek-harness-desktop' -ErrorAction SilentlyContinue) { throw '请先正常退出 Harness，再运行安装；不会强制结束正在进行的任务。' }
New-Item -ItemType Directory -Path $InstallRoot | Out-Null
& (Join-Path $sourceRoot 'runtime\node.exe') (Join-Path $sourceRoot 'Copy-Payload.mjs') $sourceRoot $InstallRoot
if ($LASTEXITCODE -ne 0) { throw '复制安装文件失败，未修改 Harness。' }
$backup = Join-Path $InstallRoot 'install-backup'
New-Item -ItemType Directory -Path $backup | Out-Null
$files = @()
foreach ($name in @('package.json','cordis.patch.yml')) {
    $target = Join-Path $ProfilePath $name
    $existed = Test-Path -LiteralPath $target
    if ($existed) { Copy-Item -LiteralPath $target -Destination (Join-Path $backup $name) }
    $files += [pscustomobject]@{Path=$target;Name=$name;Existed=$existed;InstalledHash=$null}
}
$statePath = Join-Path $InstallRoot 'install-state.json'
$state = [pscustomobject]@{InstallRoot=$InstallRoot;ProfilePath=$ProfilePath;TaskName=$taskName;ModuleLink=$module;Files=$files;Status='preparing'}
$state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statePath -Encoding UTF8
$createdTask = $false
try {
    New-Item -ItemType Directory -Path (Split-Path -Parent $module) -Force | Out-Null
    New-Item -ItemType Junction -Path $module -Target (Join-Path $InstallRoot 'offline\node_modules\@wxg-prc-cpg\browser-skill-dsh-plugin') | Out-Null
    & (Join-Path $InstallRoot 'runtime\node.exe') (Join-Path $InstallRoot 'Configure-Harness.mjs') $ProfilePath $InstallRoot
    if ($LASTEXITCODE -ne 0) { throw 'Harness 接入配置写入失败。' }
    foreach ($entry in $files) { $entry.InstalledHash = (Get-FileHash -LiteralPath $entry.Path -Algorithm SHA256).Hash }
    $ps = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $action = New-ScheduledTaskAction -Execute $ps -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$(Join-Path $InstallRoot 'run-daemon.ps1')`"" -WorkingDirectory $InstallRoot
    $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
    $settings = New-ScheduledTaskSettingsSet -Hidden -ExecutionTimeLimit ([TimeSpan]::Zero)
    Register-ScheduledTask -TaskName $taskName -Action $action -Trigger (New-ScheduledTaskTrigger -AtLogOn -User $user) -Principal $principal -Settings $settings | Out-Null
    $createdTask = $true
    Start-ScheduledTask -TaskName $taskName
    $state.Status = 'installed'
} catch {
    if ($createdTask) { Stop-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue; Unregister-ScheduledTask -TaskName $taskName -Confirm:$false }
    foreach ($entry in $files) {
        if ($entry.Existed) { Copy-Item -LiteralPath (Join-Path $backup $entry.Name) -Destination $entry.Path -Force }
        elseif (Test-Path -LiteralPath $entry.Path) { Remove-Item -LiteralPath $entry.Path }
        if (Test-Path -LiteralPath $entry.Path) { $entry.InstalledHash = (Get-FileHash -LiteralPath $entry.Path -Algorithm SHA256).Hash }
    }
    $link = Get-Item -LiteralPath $module -Force -ErrorAction SilentlyContinue
    $expectedTarget = Join-Path $InstallRoot 'offline\node_modules\@wxg-prc-cpg\browser-skill-dsh-plugin'
    if ($link -and ($link.Attributes -band [IO.FileAttributes]::ReparsePoint) -and [IO.Path]::GetFullPath([string]$link.Target) -eq [IO.Path]::GetFullPath($expectedTarget)) { [IO.Directory]::Delete($module) }
    $state.Status = 'failed; original existing configuration restored'
    throw
} finally { $state | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $statePath -Encoding UTF8 }
Write-Host "安装完成。现在重开 Harness，在 Edge 加载：$InstallRoot\extension"
Write-Host '打开开发人员模式并保持开启，启用扩展连接，端口 52800。'
