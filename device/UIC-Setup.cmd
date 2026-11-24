@echo off
REM ===========================================================================
REM  USAIndiaCFO device setup - double-click to install.
REM  Keep this file in the SAME folder as uic-device-setup.ps1.
REM  It asks for admin (UAC), takes the employee's work token, then sets up
REM  everything: activity watcher + SEB launcher + SEB config + power "always
REM  on" + Wi-Fi auto-connect + run-at-logon tasks, and runs a test.
REM
REM  NOTE ON ANTIVIRUS/SmartScreen: this tool installs kiosk + scheduled tasks,
REM  so antivirus / SmartScreen / EDR may warn on it. That is expected. The safe
REM  way to avoid it is to code-sign this with your company certificate and/or
REM  allowlist it in your company antivirus/EDR - not to hide it. If SmartScreen
REM  shows "Windows protected your PC", click "More info" -> "Run anyway".
REM ===========================================================================
setlocal
set "DASH=https://seo.usaindiacfo.us"

echo.
echo  USAIndiaCFO device setup
echo  ------------------------
echo  Dashboard: %DASH%
echo.
set /p "TOKEN=Paste this employee's WORK TOKEN (dashboard - Device setup - Get token): "
if "%TOKEN%"=="" (
  echo  No token entered. Get it from the dashboard and run this again.
  pause
  exit /b 1
)

echo.
echo  A Windows admin prompt (UAC) will appear - click Yes. Setup then runs in a new window.
echo.

REM Relaunch the PowerShell setup elevated (UAC), passing the dashboard and token.
powershell -NoProfile -ExecutionPolicy Bypass -Command "Start-Process powershell -Verb RunAs -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-File','\"%~dp0uic-device-setup.ps1\"','-Dashboard','%DASH%','-Token','%TOKEN%'"

echo.
echo  If the admin window opened, follow it to the end. You can close this window.
pause
endlocal
