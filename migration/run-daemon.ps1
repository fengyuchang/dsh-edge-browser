$ErrorActionPreference = 'Stop'
$taskRoot = $PSScriptRoot
$env:BSK_HOME = Join-Path $env:USERPROFILE '.bsk'
$env:BSK_AUTO_START = '0'
$bsk = Join-Path $taskRoot 'bin\bsk.exe'
while ($true) {
    $text = & $bsk status --json 2>$null
    if ($LASTEXITCODE -eq 0) { Start-Sleep -Seconds 15; continue }
    $status = ($text -join "`n") | ConvertFrom-Json
    if ($status.message -notlike '*automatic daemon startup is disabled*') { throw $status.message }
    $child = Start-Process -FilePath $bsk -ArgumentList @('daemon','start','--foreground') -WindowStyle Hidden -Wait -PassThru -RedirectStandardOutput (Join-Path $taskRoot 'daemon.log') -RedirectStandardError (Join-Path $taskRoot 'daemon.stderr.log')
    if ($child.ExitCode -ne 0) { throw "Browser service exited: $($child.ExitCode)" }
    Start-Sleep -Seconds 2
}
