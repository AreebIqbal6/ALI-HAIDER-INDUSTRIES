# PILOT RUNBOOK: WEAVESYNC SCADA (ALI HAIDER INDUSTRIES)
**PoE-Lite Hybrid Factory Pilot & CEO Pitch Execution Guide**
*Document Version: 1.0.0 | Date: November 2026*
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

## 2. PICANOL `XP_CBMP_P9` WIRING PINOUT

The `XP_CBMP_P9` interface on the Picanol control box delivers clean 24V DC logic pulses. Route each pin into the PC817 optocoupler inputs:

```
[ Picanol XP_CBMP_P9 ]          [ PC817 Optocoupler Board ]         [ WT32-ETH01 ]
Pin 9  (PI_STRT: Run Status)  ---> Channel 1 Input (+) ---> Output ---> GPIO 4
Pin 7  (PI_PP: Pick Pulse)    ---> Channel 2 Input (+) ---> Output ---> GPIO 2 (Interrupt)
Pin 8  (PI_WD: Warp Stop)     ---> Channel 3 Input (+) ---> Output ---> GPIO 14
Pin 10 (PI_FD: Filling Stop)  ---> Channel 4 Input (+) ---> Output ---> GPIO 15
Pin 6  (PI_LD: Selvedge Leno) ---> Channel 5 Input (+) ---> Output ---> GPIO 32
Pin 1/2 (COM GND)             ---> Optocoupler Common (-)
```

> **SAFETY RULE:** The PC817 board provides 5,000 Vrms galvanic isolation. **NEVER** connect Picanol 24V pins directly to ESP32 3.3V GPIOs.

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
⚡ Starting high-speed device simulation for 36 Picanol Looms...
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
{"success":true,"processedCount":2,"deduplicatedCount":0}
```

---

## 5. CEO PITCH & DEMONSTRATION WORKFLOW

When presenting to the CEO (on your laptop and his phone connected to `WeaveSync-Pilot`):

### 1. Show the Full 36-Machine Matrix (`http://192.168.137.1:3000`)
- Point out **Loom 1 (`PIC-427708`)** carrying the pulsating **"★ PILOT NODE"** badge.
- Explain that Loom 1 is streaming 100% live hardware data from the physical loom optocouplers, while Looms 2–36 represent the factory's full 25x OmniPlus-i, 9x OmniPlus 800, and 2x Summum machines.

### 2. Demonstrate the XP_CBMP_P9 Parallel Pin Inspector
- Tap on **Loom 1 (`PIC-427708`)**.
- Click the **"XP_CBMP_P9 Pin Inspector"** tab.
- Walk the CEO through:
  - **Pin 9 (`PI_STRT`)** showing Sumo motor status.
  - **Pin 7 (`PI_PP`)** showing live 5ms-debounced beat-up pick counts.
  - The **[-300ms, +1000ms] Stop Classification Window** that mathematically eliminates vibration chatter and distinguishes Weft Breaks (`PI_FD`) from Warp Drop-wire contacts (`PI_WD`).
  - The **FRAM Non-Volatile Ring Buffer** ensuring zero data loss during power cuts.

### 3. Trigger the Live Alert & ISO Long-Stop Declaration Workflow
- In the top header, click **"Pilot Controls"** (Secret Weapon menu).
- Select **Machine PIC-427711 (Loom 4)** and tap **"Simulate >5m Long Stop"**.
- Watch the card immediately turn amber/red with an alert sound/banner.
- Tap **"Assign Reason (>5m)"**; show the 7 ISO downtime codes (`ART`, `KNT`, `ELE`, `MEC`, `BST`, `DOF`, `OLS`).
- Tap **`[KNT] Knotting`**; show how the shift report instantly logs the operator declaration across all screens.

### 4. Live Dynamic Provisioning Demo (Looms 37–39 & 55 Toyota Looms)
- When the CEO mentions his 3 newly ordered looms or the neighboring factory's 55 Toyota looms:
- Click **"+ Provision Loom"** on the matrix.
- Select prefix (`PIC` or `TOY`), type Loom #37, select `OmniPlus-i`, and click **"Provision Machine"**.
- Loom 37 instantly appears in the live matrix in 5 seconds with zero server restarts!

---

## 6. EMERGENCY LOCAL OFFLINE SWITCH
If mobile hotspot data drops or local Wi-Fi has issues:
1. Tap the **"Cloud RT / Local Sim"** toggle pill in the top header.
2. The dashboard switches seamlessly to the in-browser local deterministic simulator.
3. Zero stuck spinners, zero crash screens, 100% smooth UI physics.
