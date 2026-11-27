# Runs "npm run backup" every day through the Windows Task Scheduler, on this computer.
#   powershell -ExecutionPolicy Bypass -File scripts\schedule-backup.ps1                  (every day at 21:00)
#   powershell -ExecutionPolicy Bypass -File scripts\schedule-backup.ps1 -Time 13:30
#   powershell -ExecutionPolicy Bypass -File scripts\schedule-backup.ps1 -Remove
# The output of each run is added to backups\backup.log, and the task's "Last Run Result" is 0 only
# when the backup was complete. If the computer is off at that time, it runs when next available.
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
# no window: an empty console that appears during the backup is easily closed, which stops it halfway.
# The launcher passes on the exit code (conhost --headless always reported success).
$launcher = Join-Path $PSScriptRoot "backup-task.wsf"
$action = New-ScheduledTaskAction -Execute "wscript.exe" -Argument "//B //Nologo `"$launcher`"" -WorkingDirectory $project
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 1)
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description "Daily backup of the Daw website and platform" -Force | Out-Null
Write-Host "The backup will run every day at $Time. Log: $project\backups\backup.log"
