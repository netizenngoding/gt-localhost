# Keeps the game server alive: starts it, and starts it again whenever node exits.
# Launched by scripts/watchdog.ps1 (which runs at logon), never by hand.
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
New-Item -ItemType Directory -Force -Path "$root\logs" | Out-Null
$out = "$root\logs\server.out.log"
$err = "$root\logs\server.err.log"

while ($true) {
  # Log tidak boleh tumbuh tanpa batas: simpan satu file lama, mulai yang baru.
  foreach ($file in @($out, $err)) {
    if ((Test-Path $file) -and (Get-Item $file).Length -gt 10MB) {
      Move-Item -Path $file -Destination "$file.old" -Force
    }
  }
  Add-Content "$root\logs\server.log" ("=== start " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + " ===")
  $cmd = "/c node server\server_runtime.cjs >> `"$out`" 2>> `"$err`""
  $proc = Start-Process -FilePath "cmd.exe" -ArgumentList $cmd -WorkingDirectory $root -WindowStyle Hidden -PassThru
  $proc.WaitForExit()
  Add-Content "$root\logs\server.log" ("=== exit " + $proc.ExitCode + " " + (Get-Date -Format "yyyy-MM-dd HH:mm:ss") + ", restart dalam 5 detik ===")
  Start-Sleep -Seconds 5
}
