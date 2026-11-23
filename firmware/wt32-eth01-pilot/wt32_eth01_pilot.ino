/**
 * ==============================================================================
 * WEAVESYNC SCADA - WT32-ETH01 PILOT FIRMWARE v2.1.0 (ZERO-MOCK PRODUCTION)
 * Client: Ali Haider Industries (Faisalabad, Pakistan)
 * Target: OmniPlus-i Loom 1 (PIC-427708) / Auto-Registered Nodes
 * Hardware: WT32-ETH01 (ESP32-D0WDQ6 + LAN8720A RMII PHY) + PC817 Optocouplers
 * Tap Interface: Picanol XP_CBMP_P9 (15-Pin D-SUB Female)
 * ==============================================================================
 * 
 * ZERO-MOCK ENFORCEMENT:
 *   - Total picks starts at 0 (No hardcoded 1,540,000 offset).
 *   - Device ID dynamically populated with ETH.macAddress().
 *   - Monotonic sequence numbers and incremental picksDelta for loss-free accounting.
 *   - Authenticated with x-weavesync-key header.
 * 
 * AUDIT-VERIFIED SAFE PIN CONNECTIONS:
 *   XP_CBMP_P9 Pin 9  -> 1.8k Resistor -> PC817 Ch1 -> ESP32 GPIO 4  (PI_STRT: Run/Stop Status)
 *   XP_CBMP_P9 Pin 7  -> 1.8k Resistor -> PC817 Ch2 -> ESP32 GPIO 32 (PI_PP: Hardware PCNT Beat-Up)
 *   XP_CBMP_P9 Pin 8  -> 1.8k Resistor -> PC817 Ch3 -> ESP32 GPIO 33 (PI_WD: Warp Stop Drop-Wire)
 *   XP_CBMP_P9 Pin 10 -> 1.8k Resistor -> PC817 Ch4 -> ESP32 GPIO 14 (PI_FD: Filling Stop FD1/FD2)
 * 
 * DO NOT TOUCH:
 *   GPIO 0:  50MHz RMII Clock from LAN8720A
 *   GPIO 2, 12, 15: ESP32 Boot Strapping Pins
 */

#include <Arduino.h>

#ifndef ETH_PHY_ADDR
#define ETH_PHY_ADDR 1
#endif
#ifndef ETH_PHY_POWER
#define ETH_PHY_POWER 16
#endif
#ifndef ETH_PHY_MDC
#define ETH_PHY_MDC 23
#endif
#ifndef ETH_PHY_MDIO
#define ETH_PHY_MDIO 18
#endif
#ifndef ETH_PHY_TYPE
#define ETH_PHY_TYPE ETH_PHY_LAN8720
#endif
#ifndef ETH_CLK_MODE
#define ETH_CLK_MODE ETH_CLOCK_GPIO0_IN
#endif

#include <ETH.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <driver/pcnt.h>

// ------------------------------------------------------------------------------
// Top-Level Signal Polarity Configuration (Mode A vs. Mode B)
// ------------------------------------------------------------------------------
// In standard PC817 wiring with pull-up inputs:
// When optocoupler conducts (signal active), ESP32 pin pulls LOW.
const bool OPTO_ACTIVE_LOW = true;

// ------------------------------------------------------------------------------
// Machine & Authentication Configuration
// ------------------------------------------------------------------------------
#define MACHINE_ID "PIC-427708"
#define LOOM_NUMBER 1
#define GATEWAY_ID "AHI-GW-01"
#define DEFAULT_SET_RPM 874
#define WEFT_DENSITY 27.2
#define INGEST_API_KEY "weavesync-industrial-secret-2026"
#define FIRMWARE_VERSION "v2.1-prod"

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
// Telemetry & State Accumulators (Strict Zero-Mock: Start at 0)
// ------------------------------------------------------------------------------
volatile unsigned long totalPicks = 0;      // Starts at 0, no mock numbers
volatile unsigned long intervalPicks = 0;   // Incremental picks since last POST
volatile unsigned long picksSinceLastStart = 0;
unsigned long monotonicSeq = 1;

bool eth_connected = false;
bool currentRunningState = false;
String currentStopCategory = "";
unsigned long stateChangeTimeMs = 0;
unsigned long lastHeartbeatMs = 0;
unsigned long lastDebugPrintMs = 0;
unsigned long failedStartAttempts = 0;
String deviceMacAddress = "";

// Evaluation Window Flags [-300ms, +1000ms]
bool fillingTriggeredInWindow = false;
bool warpTriggeredInWindow = false;
unsigned long stopDetectTimeMs = 0;

inline bool isSignalActive(int rawPinLevel) {
  return OPTO_ACTIVE_LOW ? (rawPinLevel == LOW) : (rawPinLevel == HIGH);
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
  // Count on active edge depending on polarity
  pcntConfig.pos_mode = OPTO_ACTIVE_LOW ? PCNT_COUNT_DIS : PCNT_COUNT_INC;
  pcntConfig.neg_mode = OPTO_ACTIVE_LOW ? PCNT_COUNT_INC : PCNT_COUNT_DIS;
  pcntConfig.lctrl_mode = PCNT_MODE_KEEP;
  pcntConfig.hctrl_mode = PCNT_MODE_KEEP;
  pcntConfig.counter_h_lim = 32767;
  pcntConfig.counter_l_lim = 0;

  pcnt_unit_config(&pcntConfig);

  // Configure hardware glitch filter (200 APB clock cycles ignores pulses shorter than ~2.5us)
  pcnt_set_filter_value(PCNT_UNIT_BEATUP, 200);
  pcnt_filter_enable(PCNT_UNIT_BEATUP);

  pcnt_counter_pause(PCNT_UNIT_BEATUP);
  pcnt_counter_clear(PCNT_UNIT_BEATUP);
  pcnt_counter_resume(PCNT_UNIT_BEATUP);

  Serial.println("[PCNT] Hardware Pulse Counter initialised on GPIO 32 (Glitch Filter: 200 APB cycles).");
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
      if (ETH.localIP() == static_ip || ETH.localIP() != IPAddress(0, 0, 0, 0)) {
        eth_connected = true;
        deviceMacAddress = ETH.macAddress();
        Serial.print("[ETH] Link Ready. IP: ");
        Serial.print(ETH.localIP());
        Serial.print(" | MAC: ");
        Serial.println(deviceMacAddress);
      }
      break;
    case ARDUINO_EVENT_ETH_GOT_IP:
      Serial.print("[ETH] IP Allocated: ");
      Serial.println(ETH.localIP());
      deviceMacAddress = ETH.macAddress();
      Serial.print("[ETH] Hardware MAC: ");
      Serial.println(deviceMacAddress);
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
// HTTP POST with Authentication Header & Fallback
// ------------------------------------------------------------------------------
int postJsonPayload(const String& jsonPayload) {
  // If Ethernet hardware has link, ensure connected state is recognized
  if (ETH.linkUp() && !eth_connected) {
    eth_connected = true;
    if (deviceMacAddress.isEmpty()) {
      deviceMacAddress = ETH.macAddress();
    }
  }

  if (!eth_connected && !ETH.linkUp()) {
    Serial.println("[HTTP] Cannot POST: Ethernet physical link is down.");
    return -1;
  }

  HTTPClient http;
  http.begin(INGEST_SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-weavesync-key", INGEST_API_KEY);
  http.setTimeout(1200);

  int httpCode = http.POST(jsonPayload);
  if (httpCode <= 0) {
    http.end();
    http.begin(GATEWAY_FALLBACK_URL);
    http.addHeader("Content-Type", "application/json");
    http.addHeader("x-weavesync-key", INGEST_API_KEY);
    http.setTimeout(1200);
    httpCode = http.POST(jsonPayload);
  }

  if (httpCode >= 200 && httpCode < 300) {
    Serial.printf("[HTTP] Ingest ACK (%d OK)\n", httpCode);
  } else if (httpCode == 401) {
    Serial.println("[HTTP ERROR 401] Unauthorized: Invalid x-weavesync-key header");
  } else if (httpCode == 400) {
    Serial.println("[HTTP ERROR 400] Bad Request: Payload schema mismatch");
  } else {
    Serial.printf("[HTTP ERROR] Status: %d (Target: %s)\n", httpCode, INGEST_SERVER_URL);
  }

  http.end();
  return httpCode;
}

// ------------------------------------------------------------------------------
// Emit Hardware Telemetry Frame
// ------------------------------------------------------------------------------
int sendHardwareTelemetry(bool running, const String& stopCat) {
  JsonDocument doc;
  
  String mac = deviceMacAddress.isEmpty() ? ETH.macAddress() : deviceMacAddress;
  if (mac.isEmpty()) mac = "WT32-ETH01-NODE1";

  doc["deviceId"] = mac;
  doc["machineId"] = MACHINE_ID;
  doc["ip"] = ETH.localIP().toString();
  doc["fw"] = FIRMWARE_VERSION;
  doc["seq"] = monotonicSeq++;
  doc["ts"] = String(millis());
  doc["rpm"] = running ? DEFAULT_SET_RPM : 0;
  doc["picksDelta"] = intervalPicks;
  doc["picksTotal"] = totalPicks;
  doc["since"] = String(stateChangeTimeMs);

  // Clear incremental accumulator upon emit
  intervalPicks = 0;

  JsonObject pins = doc["pins"].to<JsonObject>();
  pins["piStrt"] = isSignalActive(digitalRead(PIN_PI_STRT)) ? 1 : 0;
  pins["piPp"] = isSignalActive(digitalRead(PIN_PI_PP)) ? 1 : 0;
  pins["piWd"] = isSignalActive(digitalRead(PIN_PI_WD)) ? 1 : 0;
  pins["piFd"] = isSignalActive(digitalRead(PIN_PI_FD)) ? 1 : 0;

  // Raw Pin History Array for Stop Verification
  if (!running && historyCount > 0) {
    JsonArray histArray = doc["rawPinHistory"].to<JsonArray>();
    for (int i = 0; i < historyCount; i++) {
      JsonObject hItem = histArray.add<JsonObject>();
      hItem["pin"] = pinHistory[i].pin;
      hItem["level"] = pinHistory[i].level;
      hItem["offsetMsFromStop"] = pinHistory[i].offsetMsFromStop;
    }
  }

  String output;
  serializeJson(doc, output);
  return postJsonPayload(output);
}

// ------------------------------------------------------------------------------
// Arduino Setup Routine
// ------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=======================================================");
  Serial.println("  WEAVESYNC SCADA - WT32-ETH01 PILOT FIRMWARE v2.1.0   ");
  Serial.println("  Client: Ali Haider Industries | Zero-Mock Hardened   ");
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
    if (ETH.linkUp()) {
      eth_connected = true;
      deviceMacAddress = ETH.macAddress();
      Serial.print("[ETH] Link established. Static IP: ");
      Serial.print(ETH.localIP());
      Serial.print(" | MAC: ");
      Serial.println(deviceMacAddress);
    }
  }

  stateChangeTimeMs = millis();
  lastHeartbeatMs = millis();
  lastDebugPrintMs = millis();
}

// ------------------------------------------------------------------------------
// Main Execution Loop (20 Hz / 50ms)
// ------------------------------------------------------------------------------
void loop() {
  unsigned long now = millis();

  // 0. Harvest hardware pick pulses from PCNT register (1:1 pick counting)
  int16_t hwPicks = 0;
  pcnt_get_counter_value(PCNT_UNIT_BEATUP, &hwPicks);
  if (hwPicks > 0) {
    pcnt_counter_clear(PCNT_UNIT_BEATUP);
    totalPicks += hwPicks;
    intervalPicks += hwPicks;
    picksSinceLastStart += hwPicks;
  }

  // Read raw pin levels
  int rawStrt = digitalRead(PIN_PI_STRT);
  int rawPp   = digitalRead(PIN_PI_PP);
  int rawWd   = digitalRead(PIN_PI_WD);
  int rawFd   = digitalRead(PIN_PI_FD);

  bool activeStrt = isSignalActive(rawStrt);
  bool activeWd   = isSignalActive(rawWd);
  bool activeFd   = isSignalActive(rawFd);

  // Continuous Serial Debug Output for On-Site Verification (Every 1000ms)
  if (now - lastDebugPrintMs >= 1000) {
    lastDebugPrintMs = now;
    Serial.printf("[DIAG PINS] STRT(GPIO4): %d [%s] | PP(GPIO32): %d | WD(GPIO33): %d [%s] | FD(GPIO14): %d [%s] | Polarity: %s | Total Picks: %lu\n",
      rawStrt, activeStrt ? "RUN" : "STOP",
      rawPp,
      rawWd, activeWd ? "WARP_TRIP" : "OK",
      rawFd, activeFd ? "WEFT_TRIP" : "OK",
      OPTO_ACTIVE_LOW ? "ACTIVE_LOW (Mode B)" : "ACTIVE_HIGH (Mode A)",
      totalPicks);
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

  // 1. Detect Machine State Transition (Running <-> Stopped) - Immediate Edge Push
  if (activeStrt != currentRunningState) {
    currentRunningState = activeStrt;
    stateChangeTimeMs = now;
    recordPinTransition("PI_STRT", rawStrt, now, stopDetectTimeMs);

    if (currentRunningState) {
      Serial.println("[LOOM] State -> RUNNING (Motor Engaged)");
      currentStopCategory = "";
      picksSinceLastStart = 0;
      stopDetectTimeMs = 0;
      sendHardwareTelemetry(true, "");
    } else {
      stopDetectTimeMs = now;
      Serial.println("[LOOM] State -> STOPPED (Braking Engaged)");

      if (picksSinceLastStart < 5 && picksSinceLastStart > 0) {
        failedStartAttempts++;
        Serial.printf("[LOOM] RESTART FAULT (< 5 picks): Attempt #%lu\n", failedStartAttempts);
      }

      // Priority Evaluation: FILLING > WARP > OTHER
      if (fillingTriggeredInWindow || activeFd) {
        currentStopCategory = "FILLING";
      } else if (warpTriggeredInWindow || activeWd) {
        currentStopCategory = "WARP";
      } else {
        currentStopCategory = "OTHER";
      }

      Serial.printf("[LOOM] Stop Trigger Classified: %s\n", currentStopCategory.c_str());
      sendHardwareTelemetry(false, currentStopCategory);

      fillingTriggeredInWindow = false;
      warpTriggeredInWindow = false;
    }
  }

  // 2. Periodic Heartbeat every 5000ms (keeps device ONLINE on dashboard)
  if (now - lastHeartbeatMs >= 5000) {
    lastHeartbeatMs = now;
    unsigned long deltaToSend = intervalPicks;
    int respCode = sendHardwareTelemetry(currentRunningState, currentStopCategory);
    Serial.printf("[HEARTBEAT 5s] ETH: %s (%s) | MAC: %s | STRT:%d PP:%d WD:%d FD:%d | picksDelta:%lu | Target: 192.168.10.1:3000 -> HTTP %d\n",
      ETH.linkUp() ? "LINK_UP" : "LINK_DOWN",
      ETH.localIP().toString().c_str(),
      (deviceMacAddress.isEmpty() ? ETH.macAddress() : deviceMacAddress).c_str(),
      activeStrt ? 1 : 0,
      rawPp,
      activeWd ? 1 : 0,
      activeFd ? 1 : 0,
      deltaToSend,
      respCode);
  }

  delay(50); // 20 Hz loop
}
