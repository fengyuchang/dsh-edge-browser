param([string]$BskPath = (Join-Path $PSScriptRoot 'bin\bsk.exe'))
$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$env:BSK_HOME = Join-Path $env:USERPROFILE '.bsk'
$env:BSK_AUTO_START = '0'
$bsk = $BskPath
if (-not (Test-Path -LiteralPath $bsk -PathType Leaf)) { throw 'Browser service executable was not found.' }
while ($true) {
    try {
        $text = & $bsk status --json 2>$null
        if ($LASTEXITCODE -eq 0) { Start-Sleep -Seconds 15; continue }
        $status = ($text -join "`n") | ConvertFrom-Json
        if ($status.message -like '*automatic daemon startup is disabled*') {
            $child = Start-Process -FilePath $bsk -ArgumentList @('daemon','start','--foreground') -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $taskRoot 'daemon.log') -RedirectStandardError (Join-Path $taskRoot 'daemon.stderr.log')
            if ($child.ExitCode -ne 0) { throw "Browser service exited: $($child.ExitCode)" }
        } else {
            # A transient IPC read is not proof the other daemon is gone.
            throw "Browser status will be retried: $($status.message)"
        }
    } catch {
        ('{0:o} {1}' -f (Get-Date), $_.Exception.Message) | Add-Content -LiteralPath (Join-Path $taskRoot 'service-recovery.log')
    }
    Start-Sleep -Seconds 2
}
