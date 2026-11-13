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

:: 2. Configure Ethernet Static IP without default gateway (Prevent dropping Wi-Fi)
echo [STEP 1/4] Configuring Ethernet Adapter (192.168.10.1 / 255.255.255.0 - NO GATEWAY)...
netsh interface ip set address name="Ethernet" static 192.168.10.1 255.255.255.0 none
if %errorlevel% neq 0 (
    echo [WARN] Could not set interface "Ethernet". Trying "Ethernet 2"...
    netsh interface ip set address name="Ethernet 2" static 192.168.10.1 255.255.255.0 none
)

:: 3. Configure Windows Firewall Rules for SCADA Ports
echo [STEP 2/4] Opening Windows Firewall for SCADA Ports (3000, 4841, 1883)...
netsh advfirewall firewall add rule name="WeaveSync-SCADA-3000" dir=in action=allow protocol=TCP localport=3000 >nul 2>&1
netsh advfirewall firewall add rule name="WeaveSync-Bridge-4841" dir=in action=allow protocol=TCP localport=4841 >nul 2>&1
netsh advfirewall firewall add rule name="WeaveSync-MQTT-1883" dir=in action=allow protocol=TCP localport=1883 >nul 2>&1

:: 4. Launch Edge Gateway in a New Window
echo [STEP 3/4] Spawning Edge Gateway Service in HYBRID Mode (Port 4841)...
start "WeaveSync Edge Gateway" cmd /c "cd /d %~dp0edge-gateway && set GATEWAY_MODE=HYBRID && set PILOT_LOOM_ID=PIC-427708 && npm run dev"

:: 5. Launch Next.js SCADA Web Dashboard binding to 0.0.0.0:3000
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
npm run build && npx next start --hostname 0.0.0.0 --port 3000
