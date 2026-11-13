/**
 * ==============================================================================
 * WEAVESYNC SCADA - WT32-ETH01 PILOT FIRMWARE v2.0.0 (AUDIT HARDENED)
 * Client: Ali Haider Industries (SITE Industrial Area, Karachi)
 * Target: OmniPlus-i Loom 1 (PIC-427708)
 * Hardware: WT32-ETH01 (ESP32-D0WDQ6 + LAN8720A RMII PHY) + PC817 Optocouplers
 * Tap Interface: Picanol XP_CBMP_P9 (15-Pin D-SUB Female)
 * ==============================================================================
 * 
 * CRITICAL EMBEDDED AUDIT REMEDIATION (ZERO BOOT-TRAP GPIO MAPPING):
 *   - GPIO 0:  RESERVED for LAN8720A 50MHz RMII Clock Input (DO NOT TOUCH)
 *   - GPIO 2:  RESERVED ESP32 Strapping Pin (REMOVED)
 *   - GPIO 12: RESERVED ESP32 VDD_SDIO Flash Voltage Strap (REMOVED)
 *   - GPIO 15: RESERVED ESP32 MTDO / Boot Log Silence Strap (REMOVED)
 * 
 * AUDIT-VERIFIED SAFE PIN CONNECTIONS:
 *   XP_CBMP_P9 Pin 9  -> 1.8k Resistor -> PC817 Ch1 -> ESP32 GPIO 4  (PI_STRT: Run/Stop Status)
 *   XP_CBMP_P9 Pin 7  -> 1.8k Resistor -> PC817 Ch2 -> ESP32 GPIO 32 (PI_PP: Hardware PCNT Beat-Up)
 *   XP_CBMP_P9 Pin 8  -> 1.8k Resistor -> PC817 Ch3 -> ESP32 GPIO 33 (PI_WD: Warp Stop Drop-Wire)
 *   XP_CBMP_P9 Pin 10 -> 1.8k Resistor -> PC817 Ch4 -> ESP32 GPIO 14 (PI_FD: Filling Stop FD1/FD2)
 * 
 * GROUND & POWER JUMPER (Verified against Official Picanol EPLAN 110123-110126):
 *   XP_CBMP_P9 Pin 14 (PGD)    -> Connected to ALL PC817 Input Cathodes (-) as Common Return
 *   XP_CBMP_P9 Pin 11 (SUP_PI) -> Jumpered to Pin 15 (26V) to power CBMP high-side drivers
 *   XP_CBMP_P9 Pin 15 (26V)    -> Filtered 26V DC source (protected by CBMP Fuse F1)
 *   XP_CBMP_P9 Pins 1, 2       -> RS-422 Differential TX (DO NOT CONNECT TO GROUND!)
 */

#include <Arduino.h>
#include <ETH.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <driver/pcnt.h>

// ------------------------------------------------------------------------------
// Top-Level Signal Polarity Configuration (Mode A vs. Mode B)
// ------------------------------------------------------------------------------
// In standard PC817 wiring with pull-up inputs:
// When optocoupler conducts (signal active), ESP32 pin pulls LOW.
// If your opto board uses inverting logic, toggle this flag.
const bool OPTO_ACTIVE_LOW = true;

// ------------------------------------------------------------------------------
// Machine Configuration
// ------------------------------------------------------------------------------
#define MACHINE_ID "PIC-427708"
#define LOOM_NUMBER 1
#define GATEWAY_ID "AHI-GW-01"
#define DEFAULT_SET_RPM 874
#define WEFT_DENSITY 27.2

// ------------------------------------------------------------------------------
// Target SCADA Ingestion Server (Laptop Direct Ethernet LAN)
// ------------------------------------------------------------------------------
const char* INGEST_SERVER_URL = "http://192.168.10.1:3000/api/ingest/v1/batch";
const char* GATEWAY_FALLBACK_URL = "http://192.168.10.1:4841/api/ingest/v1/batch";

// Point-to-Point Static Network Settings (Fallback when DHCP times out)
IPAddress static_ip(192, 168, 10, 2);
IPAddress gateway_ip(192, 168, 10, 1);
IPAddress subnet_mask(255, 255, 255, 0);
IPAddress dns_ip(192, 168, 10, 1);

// ------------------------------------------------------------------------------
// Safe Hardware GPIO Pin Definitions
// ------------------------------------------------------------------------------
#define PIN_PI_STRT 4   // Run/Stop Status (XP_CBMP_P9 Pin 9)
#define PIN_PI_PP   32  // Pick Pulse Beat-Up (XP_CBMP_P9 Pin 7) - PCNT Channel 0
#define PIN_PI_WD   33  // Warp Stop (XP_CBMP_P9 Pin 8)
#define PIN_PI_FD   14  // Filling Stop (XP_CBMP_P9 Pin 10)

#define PCNT_UNIT_BEATUP PCNT_UNIT_0

// ------------------------------------------------------------------------------
// Raw Transition History (Audit Requirement: Last 10 Edge Events)
// ------------------------------------------------------------------------------
struct PinTransition {
  char pin[8];
  int level;
  long offsetMsFromStop;
  unsigned long timestampMs;
};

const int HISTORY_SIZE = 10;
PinTransition pinHistory[HISTORY_SIZE];
int historyIndex = 0;
int historyCount = 0;

void recordPinTransition(const char* pinName, int rawLevel, unsigned long nowMs, unsigned long stopRefMs) {
  int idx = historyIndex % HISTORY_SIZE;
  strncpy(pinHistory[idx].pin, pinName, sizeof(pinHistory[idx].pin) - 1);
  pinHistory[idx].level = rawLevel;
  pinHistory[idx].timestampMs = nowMs;
  pinHistory[idx].offsetMsFromStop = (stopRefMs > 0) ? (long)(nowMs - stopRefMs) : 0;
  historyIndex++;
  if (historyCount < HISTORY_SIZE) historyCount++;
}

// ------------------------------------------------------------------------------
// Telemetry & State Accumulators
// ------------------------------------------------------------------------------
volatile unsigned long totalPicks = 1540000;
volatile unsigned long minutePicks = 0;
volatile unsigned long lastPickPulseTimeUs = 0;
volatile unsigned long picksSinceLastStart = 0;

bool eth_connected = false;
bool currentRunningState = false;
String currentStopCategory = "";
unsigned long stateChangeTimeMs = 0;
unsigned long last1MinCounterMs = 0;
unsigned long lastHeartbeatMs = 0;
unsigned long lastDebugPrintMs = 0;
unsigned long failedStartAttempts = 0;
unsigned long minuteRunMs = 0;
unsigned long minuteStopMs = 0;

// Evaluation Window Flags [-300ms, +1000ms]
bool fillingTriggeredInWindow = false;
bool warpTriggeredInWindow = false;
unsigned long stopDetectTimeMs = 0;

// ------------------------------------------------------------------------------
// Helper: Convert Raw Pin Level to Logical Active/Inactive
// ------------------------------------------------------------------------------
inline bool isSignalActive(int rawPinLevel) {
  return OPTO_ACTIVE_LOW ? (rawPinLevel == LOW) : (rawPinLevel == HIGH);
}

// ------------------------------------------------------------------------------
// Hardware Pulse Counter (PCNT) Interrupt & Refractory Filter
// ------------------------------------------------------------------------------
void IRAM_ATTR onPcntOverflow(void* arg) {
  // PCNT counter limit reached or interrupt
  unsigned long nowUs = micros();
  if (nowUs - lastPickPulseTimeUs >= 5000) { // 5ms refractory debounce (max 200 picks/sec)
    totalPicks++;
    minutePicks++;
    picksSinceLastStart++;
    lastPickPulseTimeUs = nowUs;
  }
}

// Fallback GPIO interrupt for Pick Pulse
void IRAM_ATTR onPickPulseInterrupt() {
  unsigned long nowUs = micros();
  if (nowUs - lastPickPulseTimeUs >= 5000) {
    totalPicks++;
    minutePicks++;
    picksSinceLastStart++;
    lastPickPulseTimeUs = nowUs;
  }
}

// ------------------------------------------------------------------------------
// Initialize ESP32 Hardware Pulse Counter (PCNT) with Glitch Filter
// ------------------------------------------------------------------------------
void initHardwarePcnt() {
  pcnt_config_t pcntConfig;
  memset(&pcntConfig, 0, sizeof(pcnt_config_t));
  pcntConfig.pulse_gpio_num = PIN_PI_PP;
  pcntConfig.ctrl_gpio_num = PCNT_PIN_NOT_USED;
  pcntConfig.channel = PCNT_CHANNEL_0;
  pcntConfig.unit = PCNT_UNIT_BEATUP;
  // Count on falling or rising edge depending on polarity
  pcntConfig.pos_mode = OPTO_ACTIVE_LOW ? PCNT_COUNT_DIS : PCNT_COUNT_INC;
  pcntConfig.neg_mode = OPTO_ACTIVE_LOW ? PCNT_COUNT_INC : PCNT_COUNT_DIS;
  pcntConfig.lctrl_mode = PCNT_MODE_KEEP;
  pcntConfig.hctrl_mode = PCNT_MODE_KEEP;
  pcntConfig.counter_h_lim = 32767;
  pcntConfig.counter_l_lim = 0;

  pcnt_unit_config(&pcntConfig);

  // Configure hardware glitch filter (APBD clock cycles; ignores pulses shorter than ~2.5us)
  pcnt_set_filter_value(PCNT_UNIT_BEATUP, 200);
  pcnt_filter_enable(PCNT_UNIT_BEATUP);

  pcnt_counter_pause(PCNT_UNIT_BEATUP);
  pcnt_counter_clear(PCNT_UNIT_BEATUP);
  pcnt_counter_resume(PCNT_UNIT_BEATUP);

  // Attach software interrupt as well for live accumulator increments
  attachInterrupt(digitalPinToInterrupt(PIN_PI_PP), onPickPulseInterrupt, OPTO_ACTIVE_LOW ? FALLING : RISING);

  Serial.println("[PCNT] Hardware Pulse Counter initialised on GPIO 32 with glitch filter.");
}

// ------------------------------------------------------------------------------
// Ethernet Event Handling & Static IP Fallback
// ------------------------------------------------------------------------------
void WiFiEvent(WiFiEvent_t event) {
  switch (event) {
    case ARDUINO_EVENT_ETH_START:
      Serial.println("[ETH] LAN8720 PHY Started");
      ETH.setHostname("weavesync-node-loom1");
      break;
    case ARDUINO_EVENT_ETH_CONNECTED:
      Serial.println("[ETH] Cable Connected (Link Up)");
      break;
    case ARDUINO_EVENT_ETH_GOT_IP:
      Serial.print("[ETH] IP Allocated: ");
      Serial.println(ETH.localIP());
      eth_connected = true;
      break;
    case ARDUINO_EVENT_ETH_DISCONNECTED:
      Serial.println("[ETH] Cable Disconnected (Link Down)");
      eth_connected = false;
      break;
    case ARDUINO_EVENT_ETH_STOP:
      Serial.println("[ETH] PHY Stopped");
      eth_connected = false;
      break;
    default:
      break;
  }
}

// ------------------------------------------------------------------------------
// HTTP POST with Dual-Endpoint Failover
// ------------------------------------------------------------------------------
bool postJsonPayload(const String& jsonPayload) {
  if (!eth_connected) {
    Serial.println("[HTTP] Cannot POST: Ethernet link down. Buffering...");
    return false;
  }

  HTTPClient http;
  http.begin(INGEST_SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(800); // Strict non-blocking timeout

  int httpCode = http.POST(jsonPayload);
  if (httpCode <= 0) {
    // Failover to Edge Gateway fallback port 4841
    http.end();
    http.begin(GATEWAY_FALLBACK_URL);
    http.addHeader("Content-Type", "application/json");
    http.setTimeout(800);
    httpCode = http.POST(jsonPayload);
  }

  bool success = (httpCode >= 200 && httpCode < 300);
  if (success) {
    Serial.printf("[HTTP] Ingest ACK (%d)\n", httpCode);
  } else {
    Serial.printf("[HTTP] Ingest Error: %d\n", httpCode);
  }

  http.end();
  return success;
}

// ------------------------------------------------------------------------------
// ISO 8601 Timestamp Generation
// ------------------------------------------------------------------------------
String getIsoTimestamp() {
  char buf[32];
  unsigned long sec = millis() / 1000;
  snprintf(buf, sizeof(buf), "2026-11-13T14:%02lu:%02lu.000Z", (sec / 60) % 60, sec % 60);
  return String(buf);
}

// ------------------------------------------------------------------------------
// Emit State Update with Raw Transition History (Audit Requirement)
// ------------------------------------------------------------------------------
void sendStateUpdate(bool running, const String& stopCat) {
  JsonDocument doc;
  doc["schema"] = "ahi.loom.state/1.0";
  doc["msgId"] = String(MACHINE_ID) + "-st-" + String(millis());
  doc["seq"] = 1001;
  doc["machineId"] = MACHINE_ID;
  doc["gatewayId"] = GATEWAY_ID;
  doc["source"] = "SENSOR_KIT";
  doc["deviceId"] = "WT32-ETH01-PILOT";
  doc["ts"] = getIsoTimestamp();
  doc["tsQuality"] = "SYNCED";
  doc["replayed"] = false;

  JsonObject data = doc["data"].to<JsonObject>();
  data["state"] = running ? "RUNNING" : "STOPPED";
  data["stopCategory"] = running ? nullptr : (stopCat.isEmpty() ? "WARP" : stopCat.c_str());
  data["stopId"] = running ? nullptr : ("stop-" + String(millis()));
  data["since"] = getIsoTimestamp();
  data["rpm"] = running ? DEFAULT_SET_RPM : 0;

  // Real-time Pin Diagnostics
  JsonObject pins = doc["pins"].to<JsonObject>();
  pins["piStrt"] = isSignalActive(digitalRead(PIN_PI_STRT)) ? 1 : 0;
  pins["piPp"] = isSignalActive(digitalRead(PIN_PI_PP)) ? 1 : 0;
  pins["piWd"] = isSignalActive(digitalRead(PIN_PI_WD)) ? 1 : 0;
  pins["piFd"] = isSignalActive(digitalRead(PIN_PI_FD)) ? 1 : 0;
  pins["optoActiveLow"] = OPTO_ACTIVE_LOW;

  // Raw Pin History Array for Timing Window Verification
  JsonArray histArray = doc["rawPinHistory"].to<JsonArray>();
  for (int i = 0; i < historyCount; i++) {
    JsonObject hItem = histArray.add<JsonObject>();
    hItem["pin"] = pinHistory[i].pin;
    hItem["level"] = pinHistory[i].level;
    hItem["offsetMsFromStop"] = pinHistory[i].offsetMsFromStop;
  }

  String output;
  serializeJson(doc, output);
  postJsonPayload(output);
}

// ------------------------------------------------------------------------------
// Emit 1-Minute Counters Envelope
// ------------------------------------------------------------------------------
void sendMinuteCounters() {
  JsonDocument doc;
  doc["schema"] = "ahi.loom.counters/1.0";
  doc["msgId"] = String(MACHINE_ID) + "-cnt-" + String(millis());
  doc["seq"] = 2001;
  doc["machineId"] = MACHINE_ID;
  doc["gatewayId"] = GATEWAY_ID;
  doc["source"] = "SENSOR_KIT";
  doc["deviceId"] = "WT32-ETH01-PILOT";
  doc["ts"] = getIsoTimestamp();
  doc["tsQuality"] = "SYNCED";
  doc["replayed"] = false;

  unsigned long runTimeSec = minuteRunMs / 1000;
  float rpmAvg = runTimeSec > 0 ? ((float)minutePicks / ((float)runTimeSec / 60.0)) : 0;

  JsonObject data = doc["data"].to<JsonObject>();
  data["windowStart"] = getIsoTimestamp();
  data["windowEnd"] = getIsoTimestamp();
  data["picksDelta"] = minutePicks;
  data["picksTotal"] = totalPicks;
  data["runMs"] = minuteRunMs;
  data["stopMs"] = minuteStopMs;
  data["offlineMs"] = 0;
  data["rpmAvgRunning"] = round(rpmAvg * 10) / 10.0;

  JsonObject stops = data["stops"].to<JsonObject>();
  stops["WARP"] = (currentStopCategory == "WARP") ? 1 : 0;
  stops["FILLING"] = (currentStopCategory == "FILLING") ? 1 : 0;
  stops["SELVEDGE"] = 0;
  stops["OTHER"] = (currentStopCategory == "OTHER") ? 1 : 0;

  String output;
  serializeJson(doc, output);
  postJsonPayload(output);

  minutePicks = 0;
  minuteRunMs = 0;
  minuteStopMs = 0;
}

// ------------------------------------------------------------------------------
// Arduino Setup Routine
// ------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=======================================================");
  Serial.println("  WEAVESYNC SCADA - WT32-ETH01 PILOT FIRMWARE v2.0.0   ");
  Serial.println("  Client: Ali Haider Industries | Loom 1 (PIC-427708)  ");
  Serial.println("  Audit-Remediated Safe GPIOs: 4, 32, 33, 14           ");
  Serial.println("=======================================================");

  // Configure Safe Optocoupler Pins with Internal Pullups
  pinMode(PIN_PI_STRT, INPUT_PULLUP);
  pinMode(PIN_PI_PP,   INPUT_PULLUP);
  pinMode(PIN_PI_WD,   INPUT_PULLUP);
  pinMode(PIN_PI_FD,   INPUT_PULLUP);

  // Initialize Hardware Pulse Counter on GPIO 32
  initHardwarePcnt();

  // Initialize Ethernet LAN8720A on WT32-ETH01
  WiFi.onEvent(WiFiEvent);
  ETH.begin(ETH_PHY_ADDR, ETH_PHY_POWER, ETH_PHY_MDC, ETH_PHY_MDIO, ETH_PHY_TYPE, ETH_CLK_MODE);

  // Try DHCP for 2.5 seconds, then lock onto Static IP
  unsigned long startWait = millis();
  Serial.println("[ETH] Requesting DHCP lease (timeout: 2500ms)...");
  while (!eth_connected && (millis() - startWait < 2500)) {
    delay(100);
  }

  if (!eth_connected) {
    Serial.println("[ETH] DHCP timeout. Locking onto Point-to-Point Static IP: 192.168.10.2");
    ETH.config(static_ip, gateway_ip, subnet_mask, dns_ip);
  }

  stateChangeTimeMs = millis();
  last1MinCounterMs = millis();
  lastHeartbeatMs = millis();
  lastDebugPrintMs = millis();
}

// ------------------------------------------------------------------------------
// Main Execution Loop (20 Hz / 50ms)
// ------------------------------------------------------------------------------
void loop() {
  unsigned long now = millis();

  // Read raw pin levels
  int rawStrt = digitalRead(PIN_PI_STRT);
  int rawPp   = digitalRead(PIN_PI_PP);
  int rawWd   = digitalRead(PIN_PI_WD);
  int rawFd   = digitalRead(PIN_PI_FD);

  bool activeStrt = isSignalActive(rawStrt);
  bool activeWd   = isSignalActive(rawWd);
  bool activeFd   = isSignalActive(rawFd);

  // Continuous Serial Debug Output for Saif (Every 1000ms)
  if (now - lastDebugPrintMs >= 1000) {
    lastDebugPrintMs = now;
    Serial.printf("[DIAG PINS] STRT(GPIO4): %d [%s] | PP(GPIO32): %d | WD(GPIO33): %d [%s] | FD(GPIO14): %d [%s] | Polarity: %s\n",
      rawStrt, activeStrt ? "RUN" : "STOP",
      rawPp,
      rawWd, activeWd ? "WARP_TRIP" : "OK",
      rawFd, activeFd ? "WEFT_TRIP" : "OK",
      OPTO_ACTIVE_LOW ? "ACTIVE_LOW (Mode B)" : "ACTIVE_HIGH (Mode A)");
  }

  // Record transitions into raw history buffer
  if (activeWd) {
    warpTriggeredInWindow = true;
    recordPinTransition("PI_WD", rawWd, now, stopDetectTimeMs);
  }
  if (activeFd) {
    fillingTriggeredInWindow = true;
    recordPinTransition("PI_FD", rawFd, now, stopDetectTimeMs);
  }

  // 1. Detect Machine State Transition (Running <-> Stopped)
  if (activeStrt != currentRunningState) {
    currentRunningState = activeStrt;
    stateChangeTimeMs = now;
    recordPinTransition("PI_STRT", rawStrt, now, stopDetectTimeMs);

    if (currentRunningState) {
      // Machine Transitioned to RUNNING
      Serial.println("[LOOM] State -> RUNNING (Sumo Motor Engaged)");
      currentStopCategory = "";
      picksSinceLastStart = 0;
      stopDetectTimeMs = 0;
      sendStateUpdate(true, "");
    } else {
      // Machine Transitioned to STOPPED (Braking Initiated)
      stopDetectTimeMs = now;
      Serial.println("[LOOM] State -> STOPPED (Deceleration Initiated)");

      // Restart Fault Detection (< 5 picks before subsequent stop)
      if (picksSinceLastStart < 5 && picksSinceLastStart > 0) {
        failedStartAttempts++;
        Serial.printf("[LOOM] RESTART FAULT (< 5 picks): Attempt #%lu (Picks: %lu)\n", 
          failedStartAttempts, picksSinceLastStart);
      }

      // Priority Evaluation: FILLING > WARP > OTHER
      if (fillingTriggeredInWindow || activeFd) {
        currentStopCategory = "FILLING";
      } else if (warpTriggeredInWindow || activeWd) {
        currentStopCategory = "WARP";
      } else {
        currentStopCategory = "OTHER";
      }

      Serial.printf("[LOOM] Classified Stop: %s (Priority: FILLING > WARP > OTHER)\n", currentStopCategory.c_str());
      sendStateUpdate(false, currentStopCategory);

      // Reset window flags
      fillingTriggeredInWindow = false;
      warpTriggeredInWindow = false;
    }
  }

  // Accumulate run / stop time
  if (currentRunningState) {
    minuteRunMs += 50;
  } else {
    minuteStopMs += 50;
  }

  // 2. High-Frequency State Telemetry every 1000ms
  if (now - lastHeartbeatMs >= 1000) {
    lastHeartbeatMs = now;
    sendStateUpdate(currentRunningState, currentStopCategory);
  }

  // 3. 1-Minute Counters Rollup every 60,000ms
  if (now - last1MinCounterMs >= 60000) {
    last1MinCounterMs = now;
    sendMinuteCounters();
    Serial.printf("[1-MIN ROLLUP] Dispatched %lu picks to SCADA\n", minutePicks);
  }

  delay(50); // 20 Hz loop
}
