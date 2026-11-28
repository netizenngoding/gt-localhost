' Autostart Growtopia server (tanpa admin): jalankan watchdog tersembunyi saat logon.
Set shell = CreateObject("WScript.Shell")
root = "C:\Users\User\Downloads\gt-localhost-main\gt-localhost-snapshot"
shell.Run "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File """ & root & "\scripts\watchdog.ps1""", 0, False
