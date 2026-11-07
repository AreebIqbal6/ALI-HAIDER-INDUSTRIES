# PILOT RUNBOOK: WEAVESYNC SCADA (ALI HAIDER INDUSTRIES)
**PoE-Lite Hybrid Factory Pilot & CEO Pitch Execution Guide**
*Document Version: 1.1.0 | Date: November 2026*
*Hardware Target: OmniPlus-i Loom 1 (`PIC-427708`)*
*Deployment Lead: Areeb Iqbal | Hardware Lead: Saif*

---

## 1. HARDWARE ARCHITECTURE & BILL OF MATERIALS (PoE-Lite)

Before heading to Ali Haider Industries (SITE Industrial Area, Karachi), verify that you have packed the following hardware kit:

| Component | Part / Model | Purpose |
| :--- | :--- | :--- |
| **Node Controller** | WT32-ETH01 (ESP32 + LAN8720 RJ45) | On-loom edge telemetry processor |
| **Optocoupler Board** | PC817 4-Channel (or 8-Ch) 5kV opto | Galvanic isolation tapping `XP_CBMP_P9` |
| **PoE Injector** | TP-Link `TL-POE150S` (802.3af 48V) | Injects 48V DC into Ethernet line |
| **PoE Splitter** | 48V-to-5V Micro-USB / 2-Pin RJ45 Splitter | Drops 48V down to clean 5V DC for WT32 |
| **Ethernet Cables** | 2x Cat6 Patch Cables (1m & 5m) | 1m: Laptop to Injector; 5m: Injector to Loom |
| **Host Laptop** | Dell Latitude 7390 | Acts as Gateway, Local Server, and Hotspot |
| **Picanol Tap Leads** | Dupont-to-Ferrule wire harness | Plugs into `XP_CBMP_P9` connector pins |

---

## 2. PICANOL `XP_CBMP_P9` WIRING PINOUT & ELECTRICAL VERIFICATION

> ⚠️ **CRITICAL ELECTRICAL CORRECTION (CROSSCHECKED AGAINST OFFICIAL PICANOL SCHEMATICS 110123-110126):**
> - In early planning drafts, Pins 1 and 2 were mistakenly assumed to be "Common Ground".
> - **DO NOT CONNECT GROUND TO PINS 1 OR 2!** In Picanol's official EPLAN schematic (Page 55 & 125), Pin 1 is `TX_BI_L` and Pin 2 is `TX_BI_H` (RS-422 differential serial transmit). Grounding them will short the RS-422 transceiver IC!
> - The true common return ground for the parallel interface is **Pin 14 (`PGD`: Protective Ground / 0V Reference)**.
> - Pin 11 is `SUP_PI` (Parallel Interface Supply). Pin 15 is `26V` (`CBMP_26VF`: Filtered 26V DC supply from fuse F1).

### Verified DB-15 Male Tap Connector Pinout (`XP_CBMP_P9`):

```
========================================================================================
[ Picanol XP_CBMP_P9 (DB-15) ]       [ PC817 Optocoupler Board ]       [ WT32-ETH01 ]
========================================================================================
Pin 9  (PI_STRT: Run Status)   ---> Channel 1 Input (+) ---> Output ---> GPIO 4
Pin 7  (PI_PP: Pick Pulse)     ---> Channel 2 Input (+) ---> Output ---> GPIO 2 (Interrupt)
Pin 8  (PI_WD: Warp Stop)      ---> Channel 3 Input (+) ---> Output ---> GPIO 14
Pin 10 (PI_FD: Filling Stop)   ---> Channel 4 Input (+) ---> Output ---> GPIO 15
Pin 6  (PI_LD: Selvedge Leno)  ---> Channel 5 Input (+) ---> Output ---> GPIO 32
Pin 14 (PGD: Return Ground)    ---> All Optocoupler Inputs (-) [Common Ground Return]
----------------------------------------------------------------------------------------
Pin 11 (SUP_PI: Interface VCC) <--- Jumpered to Pin 15 (26V) to power high-side drivers
Pin 15 (26V: Filtered 26V DC)  ---> Ties to Pin 11 (CBMP internal fuse protected)
========================================================================================
Pins 1, 2, 3, 4, 5: RS-422 Serial BICOM (TX_L, TX_H, GND_RS422, RX_L, RX_H) - LEAVE UNCONNECTED
Pin 12: PI_RES (Reserved / Bobbin Brake) - LEAVE UNCONNECTED
Pin 13: NC (Not Connected)
```

> **RESISTOR SIZING WARNING (26V DC LOGIC):**
> Standard PC817 optocoupler breakout modules are fitted with 1kΩ SMD resistors designed for 12V DC. At Picanol's 26V DC supply, forward current would reach ~24.8 mA with ~0.61W dissipation, which will overheat small 0805 SMD resistors!
> **Mandatory:** Add an external **1.5 kΩ to 2.2 kΩ (0.5W)** resistor in series with each optocoupler input wire to keep LED current safely between 8 mA and 12 mA.

> **SCHEMATIC DRAWING QUIRK NOTE (PAGE 55):**
> On Page 55 of Picanol drawings `110123` through `110126`, the graphical text on Pin 8 inadvertently repeats the string `PI_PP`. However, the authoritative automated EPLAN Board Connector List on Page 125 confirms Pin 8 is **`PI_WD` (Warp Stop)** and Pin 7 is **`PI_PP` (Pick Pulse)**.

---

## 3. LAPTOP NETWORK & HOTSPOT CONFIGURATION

### Step 3.1: Configure Laptop Ethernet Adapter (Direct Cable to PoE Injector)
1. Open Windows **Network Connections** (`ncpa.cpl`).
2. Right-click **Ethernet** -> **Properties** -> **Internet Protocol Version 4 (TCP/IPv4)**.
3. Select **Use the following IP address**:
   - **IP Address:** `192.168.10.1`
   - **Subnet Mask:** `255.255.255.0`
   - **Default Gateway:** *Leave Blank*
4. Click **OK**.

### Step 3.2: Enable Windows Mobile Hotspot (For CEO's Smartphone)
1. Open Windows **Settings** -> **Network & Internet** -> **Mobile Hotspot**.
2. Set **Network Name (SSID):** `WeaveSync-Pilot`
3. Set **Network Password:** `AliHaider2026`
4. Turn **On** Mobile Hotspot.
5. Identify your Hotspot IP address (usually `192.168.137.1` on Windows).

---

## 4. LOCAL BENCH-TEST PROCEDURE (RUN BEFORE FACTORY DEPLOYMENT)

### Step 4.1: Start Next.js SCADA Server on All Network Interfaces
Open PowerShell on your laptop:
```powershell
cd C:\Users\ESHOP\.gemini\antigravity\scratch\ALI-HAIDER-INDUSTRIES
npm run build
npx next start --hostname 0.0.0.0 --port 3000
```
*(Or in dev mode: `npx next dev --hostname 0.0.0.0 --port 3000`)*

### Step 4.2: Start Edge Gateway in HYBRID Mode
In a second terminal:
```powershell
cd C:\Users\ESHOP\.gemini\antigravity\scratch\ALI-HAIDER-INDUSTRIES\edge-gateway
$env:GATEWAY_MODE="HYBRID"
$env:PILOT_LOOM_ID="PIC-427708"
npx ts-node src/index.ts
```
Expected output:
```
🔌 WT32-ETH01 LAN Bridge listening on http://0.0.0.0:4841 (Mode: HYBRID)
⚡ Starting high-speed device telemetry for 36 Picanol Looms...
[DISPATCH] Mode: HYBRID | Live states updated for 36 looms (1 hardware live).
```

### Step 4.3: Bench-Test Simulating Hardware Pulses (Curl Smoke-Test)
Simulate a pulse frame from the WT32-ETH01 over Ethernet:
```powershell
curl.exe -X POST http://192.168.10.1:3000/api/ingest/v1/batch `
  -H "Content-Type: application/json" `
  -d '{"machineId":"PIC-427708","pins":{"piStrt":1,"piPp":1,"piWd":0,"piFd":0,"piLd":0},"rpm":874,"picksDelta":14}'
```
Expected response:
```json
{"success":true,"received":2,"processed":2,"deduplicated":0}
```

---

## 5. CEO PITCH & DEMONSTRATION WORKFLOW

When presenting to the CEO (on your laptop and his phone connected to `WeaveSync-Pilot`):

### 1. Show the Full 36-Machine Matrix (`http://192.168.137.1:3000` or `http://localhost:3000`)
- Point out **Loom 1 (`PIC-427708`)** carrying the pulsating **"★ PILOT"** badge.
- Explain that Loom 1 is streaming 100% live hardware data from the physical loom optocouplers, while Looms 2–36 represent the factory's full 25x OmniPlus-i, 9x OmniPlus 800, and 2x Summum machines.
- Use the **7 Filter Tabs** above the matrix:
  `All (36)` • `Running` • `Stopped` • `Long Stop >5m` • `OmniPlus-i (25)` • `OmniPlus 800 (9)` • `Summum (2)`.

### 2. Demonstrate the XP_CBMP_P9 Parallel Pin Inspector
- Tap on **Loom 1 (`PIC-427708`)**.
- Click the **"XP_CBMP_P9 Pin Inspector"** tab.
- Walk the CEO through:
  - **Pin 9 (`PI_STRT`)** showing Sumo motor status.
  - **Pin 7 (`PI_PP`)** showing live 5ms-debounced beat-up pick counts.
  - The **[-300ms, +1000ms] Stop Classification Window** that mathematically eliminates vibration chatter and distinguishes Weft Breaks (`PI_FD`) from Warp Drop-wire contacts (`PI_WD`).
  - The **FRAM Non-Volatile Ring Buffer** ensuring zero data loss during power cuts.

### 3. Trigger the Live Alert & ISO Long-Stop Declaration Workflow
- In the top header, click **"Demo Controls"** (Secret Weapon menu).
- Select **Machine PIC-427711 (Loom 4)** and tap **"Simulate >5m Long Stop (Test Prompt)"**.
- Watch the card immediately turn amber/red with a live ticking stopwatch badge: `⏱️ EXCEEDED 5m: MMm SSs`.
- Tap **"⚠️ ASSIGN REASON REQUIRED (>5m)"**; show the 7 ISO downtime codes (`ART`, `KNT`, `ELE`, `MEC`, `BST`, `DOF`, `OLS`).
- Tap **`[KNT] Knotting`**; show how the shift report instantly logs the operator declaration across all screens.

### 4. Live Dynamic Commissioning Demo (Looms 37–39 & 55 Toyota Looms)
- When the CEO mentions his 3 newly ordered looms or the neighboring factory's 55 Toyota looms:
- Click **"+ Commission Loom"** on the matrix.
- Select prefix (`PIC` or `TOY`), type Loom #37, select `OmniPlus-i` (or `Toyota JAT810`), and click **"+ Commission Loom to Fleet"**.
- Loom 37 instantly appears in the live matrix in 5 seconds with zero server restarts!

---

## 6. EMERGENCY LOCAL OFFLINE SWITCH
If mobile hotspot data drops or local Wi-Fi has issues:
1. Tap the **"Demo Controls"** menu in the top header.
2. Select **"Edge Gateway Bus"** under Data Pipeline Bus.
3. The dashboard streams seamlessly over the local LAN bus.
4. Zero stuck spinners, zero crash screens, 100% smooth UI physics.
