@echo off
setlocal enabledelayedexpansion
title WEAVESYNC SCADA - Factory Pilot Launcher (Ali Haider Industries)

echo ==============================================================================
echo   WEAVESYNC SCADA - LOCAL PILOT LAUNCHER (DELL LATITUDE 7390)
echo   Client: Ali Haider Industries (SITE Area, Karachi)
echo   Hardware Target: OmniPlus-i Loom 1 (PIC-427708)
echo ==============================================================================
echo.

:: 1. Check for Administrative Privileges
net session >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Administrative permissions required to configure Ethernet interface.
    echo Please right-click START_PILOT.bat and select 'Run as administrator'.
    pause
    exit /b 1
)

:: 2. Check Node.js Runtime Version (Requires Node 22+ for native node:sqlite)
for /f "tokens=*" %%v in ('node -v 2^>nul') do set NODE_VER=%%v
echo [SYSTEM] Detected Node.js Runtime: %NODE_VER%
if "%NODE_VER%"=="" (
    echo [ERROR] Node.js is not installed or not in system PATH!
    pause
    exit /b 1
)

:: 3. Configure Ethernet Static IP without default gateway (Prevent dropping Wi-Fi)
echo [STEP 1/4] Configuring Ethernet Adapter (192.168.10.1 / 255.255.255.0 - NO GATEWAY)...
powershell -NoProfile -ExecutionPolicy Bypass -Command "$adapter = Get-NetAdapter | Where-Object { $_.InterfaceDescription -notlike '*Virtual*' -and $_.InterfaceDescription -notlike '*VPN*' -and ($_.Name -like '*Ethernet*' -or $_.MediaType -eq '802.3') } | Select-Object -First 1; if ($adapter) { Write-Host ('[NET] Configuring adapter: ' + $adapter.Name); netsh interface ip set address name=$adapter.Name static 192.168.10.1 255.255.255.0 none; Set-NetConnectionProfile -InterfaceAlias $adapter.Name -NetworkCategory Private -ErrorAction SilentlyContinue; } else { netsh interface ip set address name='Ethernet' static 192.168.10.1 255.255.255.0 none; powershell -Command \"Get-NetConnectionProfile -InterfaceAlias 'Ethernet*' | Set-NetConnectionProfile -NetworkCategory Private\" >nul 2>&1; }"

:: 4. Configure Windows Firewall Rules for SCADA Ports
echo [STEP 2/4] Opening Windows Firewall for SCADA Ports (3000, 4841, 1883)...
netsh advfirewall firewall add rule name="WeaveSync-SCADA-3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
netsh advfirewall firewall add rule name="WeaveSync-Bridge-4841" dir=in action=allow protocol=TCP localport=4841 >nul 2>&1
netsh advfirewall firewall add rule name="WeaveSync-MQTT-1883" dir=in action=allow protocol=TCP localport=1883 >nul 2>&1

:: 5. Launch Edge Gateway in a New Window
echo [STEP 3/4] Spawning Edge Gateway Service in HYBRID Mode (Port 4841)...
start "WeaveSync Edge Gateway" cmd /c "cd /d %~dp0edge-gateway && set GATEWAY_MODE=HYBRID && set PILOT_LOOM_ID=PIC-427708 && npm run dev"

:: 6. Launch Next.js SCADA Web Dashboard binding to 0.0.0.0:3000
echo [STEP 4/4] Starting Next.js SCADA Application (0.0.0.0:3000)...
echo.
echo ==============================================================================
echo   PILOT ACCESS URLs:
echo   - Laptop Browser:  http://localhost:3000
echo   - Direct Ethernet: http://192.168.10.1:3000
echo   - CEO Smartphone:  http://192.168.137.1:3000 (Connect to Hotspot 'WeaveSync-Pilot')
echo ==============================================================================
echo.

cd /d "%~dp0"
if not exist .next (
    echo [BUILD] Building production Next.js bundle...
    call npm run build
)
npx next start --hostname 0.0.0.0 --port 3000
