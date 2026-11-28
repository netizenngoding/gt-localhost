# Watchdog tanpa admin: tiap 30 detik cek port 3000, kalau mati jalankan supervisor.
$root = Split-Path -Parent $PSScriptRoot
while ($true) {
  $listening = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
  $supervisor = Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like "*run-server.ps1*" }
  if (-not $listening -and -not $supervisor) {
    Start-Process -FilePath "powershell.exe" -ArgumentList @("-NoProfile", "-WindowStyle", "Hidden", "-ExecutionPolicy", "Bypass", "-File", "`"$root\scripts\run-server.ps1`"") -WindowStyle Hidden
    Add-Content "$root\logs\server.log" ("=== watchdog: server mati, dijalankan ulang " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " ===")
  }
  Start-Sleep -Seconds 30
}
