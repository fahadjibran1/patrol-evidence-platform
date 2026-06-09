param(
  [string]$TaskName = "PatrolEvidenceBackend",
  [ValidateSet("AtLogOn", "AtStartup")]
  [string]$Trigger = "AtLogOn",
  [string]$ProjectRoot = "",
  [switch]$RunElevated
)

$ErrorActionPreference = "Stop"

# If you move the project, pass -ProjectRoot explicitly when installing the task.
if ([string]::IsNullOrWhiteSpace($ProjectRoot)) {
  $ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
}

$StartupScript = Join-Path $ProjectRoot "scripts\windows\start-backend.bat"

if (-not (Test-Path $StartupScript)) {
  throw "Startup script not found: $StartupScript"
}

$Action = New-ScheduledTaskAction -Execute $StartupScript

if ($Trigger -eq "AtStartup") {
  $TaskTrigger = New-ScheduledTaskTrigger -AtStartup
}
else {
  $TaskTrigger = New-ScheduledTaskTrigger -AtLogOn
}

$Principal = if ($RunElevated) {
  New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType InteractiveToken -RunLevel Highest
}
else {
  New-ScheduledTaskPrincipal -UserId $env:USERNAME -LogonType InteractiveToken -RunLevel Limited
}

$Settings = New-ScheduledTaskSettingsSet `
  -AllowStartIfOnBatteries `
  -DontStopIfGoingOnBatteries `
  -MultipleInstances IgnoreNew `
  -ExecutionTimeLimit (New-TimeSpan -Hours 0)

Register-ScheduledTask `
  -TaskName $TaskName `
  -Action $Action `
  -Trigger $TaskTrigger `
  -Principal $Principal `
  -Settings $Settings `
  -Description "Starts the Patrol Evidence Platform backend on $Trigger." `
  -Force

Write-Host "Scheduled task '$TaskName' installed."
Write-Host "Project root: $ProjectRoot"
Write-Host "Startup script: $StartupScript"
Write-Host "Trigger: $Trigger"
Write-Host ""
Write-Host "Notes:"
Write-Host "- Update -ProjectRoot if the project folder changes."
Write-Host "- The backend startup already loads the WhatsApp collector behavior from .env."
Write-Host "- If WHATSAPP_AUTO_START=false, the task starts the backend only; start the collector via the API when needed."
