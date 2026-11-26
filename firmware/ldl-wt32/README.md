# ldl-wt32 — Loom Data Logger firmware (WT32-ETH01, ESP-IDF v5.3)

The logger taps a Picanol loom's P9 signals through PC817 optocouplers. It
classifies run/stop states and stop causes, counts picks, and delivers
Data Contract v1 envelopes (`contract/v1`) over HTTPS to
`<url>/api/ingest/v1/batch`. Messages are buffered in flash, so nothing is
lost while the network or the backend is down.

```
GPIO ISR (IRAM) ──ring──> loom task ──debounce──> classifier ──> app_publish
PCNT (GPIO4) ─────────────────┘                                  │ encode (cJSON)
                                                                 v
                    uplink task <──notify── store task ──> outbox ring (flash)
                         │ HTTPS batch ≤50             └──> journal ring (flash)
                         v
                    backend: stored|duplicate|rejected → ack (delete)
```

| Path | Contents |
|---|---|
| `components/ldl_core/` | Pure C, no ESP dependencies: classifier, contract encoder, UUIDv7/ISO time/CRC, journal and outbox rings over a small flash HAL |
| `main/` | ESP-IDF glue: `board_wt32_eth01.h`, net, timesync, inputs, store, uplink, statuspage, led, config/console, ota, app (loom task), main |
| `test/host/` | Unity host tests (gcc): classifier scenarios, golden contract files, UUIDv7, rings on an in-memory NOR flash shim |

## Wiring

All inputs are active-low: when the signal is ON, the opto pulls the GPIO LOW.
The 817 modules carry external 22 kΩ pull-ups, so the internal pull-ups stay
disabled. GPIO34–39 have no internal pull-ups anyway.

| Signal | P9 signal | 817 module channel | WT32 GPIO | Use |
|---|---|---|---|---|
| IN1 | PI_STRT (running) | module 1 ch1 | GPIO36 | run/stop state |
| IN2 | PI_PP (pick pulse) | module 1 ch2 | GPIO4 | PCNT pick counter + rpm |
| IN3 | PI_WD (warp stop) | module 2 ch1 | GPIO32 | stop cause WARP |
| IN4 | PI_FD (filling stop) | module 2 ch2 | GPIO33 | stop cause FILLING |
| IN5 | PI_LD (selvedge stop) | module 3 ch1 | GPIO35 | stop cause SELVEDGE |
| IN6 | PI_RES (reserve) | module 3 ch2 | GPIO39 | logged only |
| LED | — | — | GPIO2 | status LED (active high, 1 kΩ to GND) |

Ethernet (fixed on the board): LAN8720, PHY addr 1, MDC GPIO23, MDIO GPIO18,
oscillator enable GPIO16, RMII clock in on GPIO0. Do not use GPIO0 or GPIO12
for anything else.

## Flash layout (`partitions.csv`, 4 MB)

| Name | Type | Offset | Size | Purpose |
|---|---|---|---|---|
| nvs | data/nvs | 0x9000 | 24 KB | config, bootId |
| otadata | data/ota | 0xf000 | 8 KB | OTA slot selection |
| phy_init | data/phy | 0x11000 | 4 KB | |
| ota_0 | app | 0x20000 | 1.5 MB | firmware slot A |
| ota_1 | app | 0x1a0000 | 1.5 MB | firmware slot B |
| journal | data/0x40 | 0x320000 | 256 KB | counter journal (32-byte records) |
| outbox | data/0x41 | 0x360000 | 640 KB | message ring |

## Build (Docker, no local IDF needed)

```sh
docker run --rm -v "<repo>:/project" -w /project/firmware/ldl-wt32 \
  espressif/idf:v5.3 idf.py set-target esp32 build
```

Host unit tests:

```sh
docker run --rm -v "<repo>:/project" -w /project/firmware/ldl-wt32/test/host \
  espressif/idf:v5.3 bash -c "cmake -B build && cmake --build build && ./build/ldl_host_tests"
```

## Flashing (3.3 V USB-serial adapter)

The board has no USB port. Wire the adapter: TX→RX0, RX→TX0, GND→GND, and
3.3 V→3V3 (or 5 V→5V). Never feed 5 V into the 3V3 pin. To enter download
mode, hold IO0 to GND while you power up or reset the board, then release it
once flashing has started.

```sh
esptool.py --chip esp32 -p COM5 -b 460800 write_flash --flash_mode dio --flash_size 4MB \
  0x1000 build/bootloader/bootloader.bin \
  0x8000 build/partition_table/partition-table.bin \
  0xf000 build/ota_data_initial.bin \
  0x20000 build/ldl-wt32.bin
```

`idf.py -p COM5 flash` does the same. Docker on Windows cannot reach COM
ports, so run esptool on the host (`pip install esptool`). After flashing,
remove the IO0 jumper and reset the board.

## Provisioning (serial console, 115200 8N1)

```
ldl> set url https://ingest.example.com      # base URL, no path
ldl> set token <device-token>                 # stored in NVS only, never compiled in
ldl> set machine PIC-427708
ldl> set ntp pool.ntp.org                     # reboot to apply
ldl> set static_ip 192.168.10.2               # optional fallback if DHCP fails (10 s)
ldl> set gateway 192.168.10.1
ldl> set netmask 255.255.255.0
ldl> set dns 192.168.10.1
ldl> show                                     # token is masked
ldl> get url
ldl> reboot
ldl> ota https://host/ldl-wt32.bin            # optional HTTPS OTA
```

`set <key>` with no value clears the override and restores the Kconfig default.
The Kconfig defaults (`idf.py menuconfig` → *Loom Data Logger*) are the endpoint
(empty), machine id, SNTP server, the classification windows (−300/+1000 ms),
the failed-start pick limit (5), and the debounce time (20 ms).

## LED codes

| Pattern | Meaning |
|---|---|
| fast blink (5 Hz) | no Ethernet link |
| slow blink (1 Hz) | link up, but no successful upload yet or the last upload failed |
| steady on | uploads OK; a short off-pulse marks each successful batch |

## Status page

Open `http://<device-ip>/` for a live page with input lamps, state, picks, rpm,
backlog and the last uplink result. `GET /status.json` returns the same data as
JSON. The token is never exposed. The device registers via DHCP with the
hostname `ldl-<mac>`.

## Messages

All messages use the envelope from `contract/v1`. `deviceId` is the Ethernet
MAC as lowercase hex, `source` is `LDL`, `gatewayId` is `none`, and `msgId` and
`stopId` are UUIDv7. `seq` restarts at 1 on every boot, and `bootId` is an NVS
counter. `tsQuality` is `SYNCED` after SNTP; otherwise it is `ESTIMATED`
(uptime plus the offset from the last `serverTime`).

* **state** — sent on every change and every 60 s. While running, `stopCategory` and `stopId` are `null`.
* **events**:
  * `STOP_STARTED` is sent once the +1000 ms classification window closes, with `detectedAt` set to the STRT edge.
  * `STOP_ENDED` is sent once the run is confirmed (more than 5 picks after restart). It carries `durationMs` and `failedStartAttempts`.
  * `START_ATTEMPT_FAILED` carries `attempt` and `picksInAttempt`.
  * `COUNTER_DISCONTINUITY` (reason `COUNTERS_LOST`) is sent at boot when the journal holds no valid record.
* **counters** — one message per wall-clock minute. `runMs`, `stopMs` and `offlineMs` sum to the window length. `rpmAvgRunning` is picks while running divided by run time.
* **health** — sent every 60 s.

Stop priority: FILLING > WARP > SELVEDGE > OTHER. An input counts toward a stop
if it was active anywhere in [edge − 300 ms, edge + 1000 ms].

## Buffering and replay

* **Outbox:** each encoded envelope is appended to the outbox ring as a
  `{magic, rid, bootId, len, flags, crc}` record. Records never span a 4 KB
  sector, and a sector is erased only when the writer enters it. If the ring
  is full, the oldest sector is dropped and counted (`bufferDropped`).
* **Acknowledgement:** the uplink sends up to 50 of the oldest records per
  batch. For each `msgId` answered `stored`, `duplicate` or `rejected`, the
  record's *pending* flag bit is cleared in place (NOR 1→0). That bit is the
  persisted read pointer, and acknowledgement always advances in order.
  Rejected records are logged and counted.
* **Replay after reboot:** the boot scan resumes at the oldest pending record.
  Records written in an earlier boot are re-sent with `"replayed":true` and the
  same `msgId`, so the server deduplicates them.
* **Backoff:** a 401 or 403 pauses uploads for 5 min. A 429, a 5xx or a network
  error backs off from 2 s up to 5 min and keeps the records. For any other 4xx,
  the uplink retries the records one at a time and discards a single record
  only if the server refuses it on its own.
* **Journal:** a 32-byte counter record (picks, run and stop totals) is written
  every second while picks change, and at least once a minute otherwise. On
  boot, the newest record with a valid CRC restores `picksTotal`. A power cut
  loses at most about 1 s of picks.
* **ISR safety:** all flash writes happen in the store task. The GPIO ISR and
  the PCNT overflow ISR are IRAM-safe, so inputs keep being captured while the
  flash cache is disabled.

## OTA and rollback

`CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE` is on. An image installed via
`ota <url>` is marked valid after its first successful batch upload. If the
device resets before that, the bootloader reverts to the previous slot.
