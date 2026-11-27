# Runs "npm run backup" every day through the Windows Task Scheduler, on this computer.
#   powershell -ExecutionPolicy Bypass -File scripts\schedule-backup.ps1                  (every day at 21:00)
#   powershell -ExecutionPolicy Bypass -File scripts\schedule-backup.ps1 -Time 13:30
#   powershell -ExecutionPolicy Bypass -File scripts\schedule-backup.ps1 -Remove
# The result of each run is added to backups\backup.log. If the computer is off at that time,
# the backup runs when it is next available.
param([string]$Time = "21:00", [switch]$Remove)

$ErrorActionPreference = "Stop"
$name = "DawSiteBackup"
$project = Split-Path -Parent $PSScriptRoot

if ($Remove) {
    Unregister-ScheduledTask -TaskName $name -Confirm:$false
    Write-Host "Removed the daily backup task."
    return
}

New-Item -ItemType Directory -Force (Join-Path $project "backups") | Out-Null
$action = New-ScheduledTaskAction -Execute "cmd.exe" -Argument '/c npm.cmd run backup >> backups\backup.log 2>&1' -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description "Daily backup of the Daw website and platform" -Force | Out-Null
Write-Host "The backup will run every day at $Time. Log: $project\backups\backup.log"
