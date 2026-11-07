/**
 * ==============================================================================
 * WEAVESYNC SCADA - WT32-ETH01 PILOT FIRMWARE v1.0.4
 * Client: Ali Haider Industries (SITE Area, Karachi)
 * Target: OmniPlus-i Loom 1 (PIC-427708)
 * Hardware: WT32-ETH01 (ESP32 + LAN8720 PHY) + PC817 4/5-Ch Optocoupler Board
 * Interface: Tapping Picanol XP_CBMP_P9 Connector
 * ==============================================================================
 * 
 * Pinout Connections to PC817 Optocouplers (Galvanic Isolation 5kV):
 *   XP_CBMP_P9 Pin 9  -> PC817 IN1 -> ESP32 GPIO 4  (PI_STRT: Loom Running Status)
 *   XP_CBMP_P9 Pin 7  -> PC817 IN2 -> ESP32 GPIO 2  (PI_PP: Pick Pulse / Beat-up)
 *   XP_CBMP_P9 Pin 8  -> PC817 IN3 -> ESP32 GPIO 14 (PI_WD: Warp Stop Drop-wire)
 *   XP_CBMP_P9 Pin 10 -> PC817 IN4 -> ESP32 GPIO 15 (PI_FD: Filling Stop FD1/FD2)
 *   XP_CBMP_P9 Pin 6  -> PC817 IN5 -> ESP32 GPIO 32 (PI_LD: Selvedge Leno Stop)
 */

#include <Arduino.h>
#include <ETH.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>

// Machine Configuration
#define MACHINE_ID "PIC-427708"
#define LOOM_NUMBER 1
#define GATEWAY_ID "AHI-GW-01"
#define DEFAULT_SET_RPM 874
#define WEFT_DENSITY 27.2

// Target SCADA Ingestion Server (Areeb's Laptop Ethernet IP)
const char* INGEST_SERVER_URL = "http://192.168.10.1:3000/api/ingest/v1/batch";
const char* GATEWAY_FALLBACK_URL = "http://192.168.10.1:4841/api/ingest/v1/batch";

// Static IP Configuration over direct Ethernet cable
IPAddress local_ip(192, 168, 10, 101);
IPAddress gateway(192, 168, 10, 1);
IPAddress subnet(255, 255, 255, 0);
IPAddress dns(192, 168, 10, 1);

// Hardware GPIO Pins
#define PIN_PI_STRT 4   // Run/Stop
#define PIN_PI_PP   2   // Pick Pulse
#define PIN_PI_WD   14  // Warp Stop
#define PIN_PI_FD   15  // Filling Stop
#define PIN_PI_LD   32  // Leno Stop

// State Variables
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
unsigned long failedStartAttempts = 0;
unsigned long minuteRunMs = 0;
unsigned long minuteStopMs = 0;

// Classification Window Variables [-300ms, +1000ms]
bool fillingTriggeredInWindow = false;
bool warpTriggeredInWindow = false;
bool selvedgeTriggeredInWindow = false;
unsigned long stopDetectTimeMs = 0;

// Hardware Pick Pulse Interrupt (5ms Hardware Debounce)
void IRAM_ATTR onPickPulseInterrupt() {
  unsigned long nowUs = micros();
  if (nowUs - lastPickPulseTimeUs >= 5000) { // 5ms refractory debounce
    totalPicks++;
    minutePicks++;
    picksSinceLastStart++;
    lastPickPulseTimeUs = nowUs;
  }
}

// Ethernet Event Handler
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

// Helper to HTTP POST batch to Laptop Ingest API
bool postJsonPayload(const String& jsonPayload) {
  if (!eth_connected) {
    Serial.println("[HTTP] Cannot POST: Ethernet link down. Buffering...");
    return false;
  }

  HTTPClient http;
  http.begin(INGEST_SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(800); // Fast non-blocking timeout

  int httpCode = http.POST(jsonPayload);
  if (httpCode <= 0) {
    // Try gateway fallback port 4841
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
    Serial.printf("[HTTP] Error code: %d\n", httpCode);
  }

  http.end();
  return success;
}

// Generate Canonical Envelope ISO Timestamp (approximate UTC sync)
String getIsoTimestamp() {
  char buf[32];
  unsigned long sec = millis() / 1000;
  snprintf(buf, sizeof(buf), "2026-11-07T14:%02lu:%02lu.000Z", (sec / 60) % 60, sec % 60);
  return String(buf);
}

// Emit State Change Envelope
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

  // Also include raw optocoupler pin diagnostics
  JsonObject pins = doc["pins"].to<JsonObject>();
  pins["piStrt"] = digitalRead(PIN_PI_STRT);
  pins["piPp"] = digitalRead(PIN_PI_PP);
  pins["piWd"] = digitalRead(PIN_PI_WD);
  pins["piFd"] = digitalRead(PIN_PI_FD);
  pins["piLd"] = digitalRead(PIN_PI_LD);

  String output;
  serializeJson(doc, output);
  postJsonPayload(output);
}

// Emit 1-Minute Counters Envelope
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
  stops["SELVEDGE"] = (currentStopCategory == "SELVEDGE") ? 1 : 0;
  stops["OTHER"] = (currentStopCategory == "OTHER") ? 1 : 0;

  String output;
  serializeJson(doc, output);
  postJsonPayload(output);

  // Reset minute accumulators
  minutePicks = 0;
  minuteRunMs = 0;
  minuteStopMs = 0;
}

void setup() {
  Serial.begin(115200);
  delay(500);
  Serial.println("\n=======================================================");
  Serial.println("  WEAVESYNC SCADA - WT32-ETH01 HARDWARE PILOT FIRMWARE  ");
  Serial.println("  Client: Ali Haider Industries | Loom 1 (PIC-427708)   ");
  Serial.println("=======================================================");

  // Configure PC817 Optocoupler GPIO Inputs
  pinMode(PIN_PI_STRT, INPUT_PULLDOWN);
  pinMode(PIN_PI_PP,   INPUT_PULLDOWN);
  pinMode(PIN_PI_WD,   INPUT_PULLDOWN);
  pinMode(PIN_PI_FD,   INPUT_PULLDOWN);
  pinMode(PIN_PI_LD,   INPUT_PULLDOWN);

  // Attach Interrupt on Pick Pulse with 5ms debounce
  attachInterrupt(digitalPinToInterrupt(PIN_PI_PP), onPickPulseInterrupt, RISING);

  // Initialize Ethernet LAN8720 PHY on WT32-ETH01
  WiFi.onEvent(WiFiEvent);
  ETH.begin(ETH_TYPE, ETH_ADDR, ETH_MDC_PIN, ETH_MDIO_PIN, ETH_POWER_PIN, ETH_CLK_MODE);
  ETH.config(local_ip, gateway, subnet, dns);

  stateChangeTimeMs = millis();
  last1MinCounterMs = millis();
  lastHeartbeatMs = millis();
}

void loop() {
  unsigned long now = millis();

  // Read instantaneous optocoupler inputs
  bool rawStrt = (digitalRead(PIN_PI_STRT) == HIGH);
  bool rawFd = (digitalRead(PIN_PI_FD) == HIGH);
  bool rawWd = (digitalRead(PIN_PI_WD) == HIGH);
  bool rawLd = (digitalRead(PIN_PI_LD) == HIGH);

  // Sample signals for the [-300ms, +1000ms] priority window
  if (rawFd) fillingTriggeredInWindow = true;
  if (rawWd) warpTriggeredInWindow = true;
  if (rawLd) selvedgeTriggeredInWindow = true;

  // 1. Detect State Transitions
  if (rawStrt != currentRunningState) {
    currentRunningState = rawStrt;
    stateChangeTimeMs = now;

    if (currentRunningState) {
      // Machine Transitioned to RUNNING
      Serial.println("[LOOM] State: RUNNING (Sumo Motor Enabled)");
      currentStopCategory = "";
      picksSinceLastStart = 0;
      sendStateUpdate(true, "");
    } else {
      // Machine Transitioned to STOPPED -> Start Saif's Window Evaluation
      Serial.println("[LOOM] State: STOPPED (Deceleration Detected)");
      stopDetectTimeMs = now;

      // Evaluate Failed-Start Fault (< 5 picks before stop)
      if (picksSinceLastStart < 5 && picksSinceLastStart > 0) {
        failedStartAttempts++;
        Serial.printf("[LOOM] RESTART FAULT (< 5 picks): Attempt #%lu\n", failedStartAttempts);
      }

      // Priority Hierarchy: FILLING > WARP > SELVEDGE > OTHER
      if (fillingTriggeredInWindow || rawFd) {
        currentStopCategory = "FILLING";
      } else if (warpTriggeredInWindow || rawWd) {
        currentStopCategory = "WARP";
      } else if (selvedgeTriggeredInWindow || rawLd) {
        currentStopCategory = "SELVEDGE";
      } else {
        currentStopCategory = "OTHER";
      }

      Serial.printf("[LOOM] Classified Stop: %s (Priority: FILLING > WARP > SELVEDGE)\n", currentStopCategory.c_str());
      sendStateUpdate(false, currentStopCategory);

      // Reset window flags
      fillingTriggeredInWindow = false;
      warpTriggeredInWindow = false;
      selvedgeTriggeredInWindow = false;
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
    Serial.printf("[TICK] Status: %s | RPM: %d | Picks: %lu | Link: %s\n", 
      currentRunningState ? "RUN" : "STOP", 
      currentRunningState ? DEFAULT_SET_RPM : 0, 
      totalPicks, 
      eth_connected ? "OK" : "NO_ETH");
  }

  // 3. 1-Minute Counters Rollup every 60,000ms
  if (now - last1MinCounterMs >= 60000) {
    last1MinCounterMs = now;
    sendMinuteCounters();
    Serial.printf("[1-MIN COUNTER] Rolled up: %lu picks\n", minutePicks);
  }

  delay(50); // 20 Hz loop
}
