# Creates a Desktop shortcut that starts Pulse with no console window.
# The shortcut is only a link: the program itself must NOT live under Desktop (see README).
$root = Split-Path -Parent $PSScriptRoot
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Pulse.lnk'
$shell = New-Object -ComObject WScript.Shell
$s = $shell.CreateShortcut($lnk)
$s.TargetPath = Join-Path $env:SystemRoot 'System32\wscript.exe'
$s.Arguments = '"' + (Join-Path $root 'start-pulse.vbs') + '"'
$s.WorkingDirectory = $root
$s.IconLocation = (Join-Path $root 'build\icon.ico') + ',0'
$s.Description = 'Start Pulse (Windows port)'
$s.WindowStyle = 7
$s.Save()
"created $lnk -> $($s.TargetPath) $($s.Arguments)" | Out-File (Join-Path $root 'shortcut.txt')
