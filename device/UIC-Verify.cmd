@echo off
REM ===========================================================================
REM  USAIndiaCFO device VERIFY + self-heal - double-click to run.
REM  Keep this file in the SAME folder as uic-verify.ps1.
REM  It asks for admin (UAC), then checks the whole setup and fixes any
REM  device-side item on its own. It reads the dashboard + token from the
REM  installed scheduled task automatically.
REM ===========================================================================
echo.
echo  USAIndiaCFO device verify
echo  -------------------------
echo  A Windows admin prompt (UAC) will appear - click Yes. Results open in a new window.
echo.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-NoExit','-File','\"%~dp0uic-verify.ps1\"'"
echo.
echo  If the admin window opened, read the SUMMARY at the bottom. You can close this window.
pause
