@echo off
setlocal
title MagnoliaPS Beta (Server + Cloudflare Tunnel)
cd /d "%~dp0"

:: Port 8085 digunakan untuk menghindari tabrakan dengan Steam CEF di port 8080
set PORT=8085

where node >nul 2>nul || (echo [!] Node.js belum terinstall: https://nodejs.org & pause & exit /b 1)

where cloudflared >nul 2>nul
if errorlevel 1 (
  echo [*] cloudflared belum ada, install via winget...
  winget install --id Cloudflare.cloudflared -e --accept-source-agreements --accept-package-agreements
  echo.
  echo [!] Tutup jendela ini lalu jalankan BETA_START.bat lagi supaya cloudflared terbaca.
  pause & exit /b 0
)

if not exist node_modules (
  echo [*] npm install...
  call npm install || (pause & exit /b 1)
)

echo [*] Build server...
call npm run build || (pause & exit /b 1)

echo [*] Menjalankan server di port %PORT%...
start "MagnoliaPS Server" cmd /k "set PORT=%PORT%&& npm start"
timeout /t 3 >nul

echo.
echo ================================================================
echo  Cari link  https://xxxx.trycloudflare.com  di bawah ini,
echo  lalu kirim ke tester. Tutup jendela ini untuk menghentikan tunnel.
echo ================================================================
cloudflared tunnel --url http://127.0.0.1:%PORT% --http-host-header "127.0.0.1:%PORT%"
pause
