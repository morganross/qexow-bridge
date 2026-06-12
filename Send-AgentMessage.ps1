<#
.SYNOPSIS
    Sends a message to an agent via the Qexow CAM system.
.PARAMETER Target
    The friendly command alias of the target agent (e.g. boss-master-overseer-president).
.PARAMETER Message
    The message text to send to the target agent.
.EXAMPLE
    .\Send-AgentMessage.ps1 -Target "boss-master-overseer-president" -Message "Hello from Antigravity!"
#>
param(
    [Parameter(Mandatory=$true)]
    [string]$Target,
    
    [Parameter(Mandatory=$true)]
    [string]$Message
)

$camPath = $env:CAM_HOME
if (-not $camPath) {
    $scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
    $devPath = Resolve-Path (Join-Path $scriptDir "..\qexow-cam") -ErrorAction SilentlyContinue
    if ($devPath -and (Test-Path $devPath.Path)) {
        $camPath = $devPath.Path
    } else {
        $camPath = Join-Path $env:USERPROFILE ".qexow-cam"
    }
}

if (-not (Test-Path $camPath) -or -not (Test-Path (Join-Path $camPath "codex-send.cmd"))) {
    Throw "Error: Qexow CAM directory not found or invalid at '$camPath'. Fallbacks are disabled."
}

Push-Location $camPath
try {
    # Execute the send command and parse the output JSON
    $output = .\codex-send.cmd $Target $Message --from antigravity
    Write-Output $output
}
catch {
    Write-Error "Failed to execute codex-send.cmd command: $_"
}
finally {
    Pop-Location
}
