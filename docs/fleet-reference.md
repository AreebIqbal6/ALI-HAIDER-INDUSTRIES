# Ali Haider Industries - 36 Picanol Weaving Looms Reference

This document serves as the canonical factory floor registry reference for Ali Haider Industries (Faisalabad, Pakistan). 

> **NOTICE:** In accordance with the Zero-Mock SCADA architecture, these machines are **never** seeded automatically into the live database. Machines are auto-registered strictly when physical hardware (`WT32-ETH01` or Edge Gateway) transmits an authenticated heartbeat to `/api/ingest/v1/batch`. Floor supervisors use this document to configure and label newly discovered hardware devices.

---

## Shed Fleet Breakdown

### 1. Picanol OmniPlus-i (25 Looms, Shed Area A)
- **Year Recorded**: July - August 2021
- **Interface**: Picanol XP_CBMP_P9 Optocoupled + BICOM Ethernet
- **Default Speed**: 874 RPM
- **Default Weft Density**: 27.2 picks/cm

| Loom # | Machine ID | Model | Manufacturing Date | Static IP | Pilot Role |
|---|---|---|---|---|---|
| **1** | `PIC-427708` | OmniPlus-i | 07/2021 | `192.168.10.101` | **Pilot Hardware Node (WT32-ETH01 #1)** |
| 2 | `PIC-427709` | OmniPlus-i | 07/2021 | `192.168.10.102` | Production |
| 3 | `PIC-427710` | OmniPlus-i | 07/2021 | `192.168.10.103` | Production |
| 4 | `PIC-427711` | OmniPlus-i | 07/2021 | `192.168.10.104` | Production |
| 5 | `PIC-427712` | OmniPlus-i | 07/2021 | `192.168.10.105` | Production |
| 6 | `PIC-427713` | OmniPlus-i | 07/2021 | `192.168.10.106` | Production |
| 7 | `PIC-427714` | OmniPlus-i | 07/2021 | `192.168.10.107` | Production |
| 8 | `PIC-427715` | OmniPlus-i | 07/2021 | `192.168.10.108` | Production |
| 9 | `PIC-427716` | OmniPlus-i | 07/2021 | `192.168.10.109` | Production |
| 10 | `PIC-427717` | OmniPlus-i | 07/2021 | `192.168.10.110` | Production |
| 11 | `PIC-427718` | OmniPlus-i | 07/2021 | `192.168.10.111` | Production |
| 12 | `PIC-427719` | OmniPlus-i | 07/2021 | `192.168.10.112` | Production |
| 13 | `PIC-427720` | OmniPlus-i | 07/2021 | `192.168.10.113` | Production |
| 14 | `PIC-427721` | OmniPlus-i | 07/2021 | `192.168.10.114` | Production |
| 15 | `PIC-427722` | OmniPlus-i | 07/2021 | `192.168.10.115` | Production |
| 16 | `PIC-427723` | OmniPlus-i | 08/2021 | `192.168.10.116` | Production |
| 17 | `PIC-427724` | OmniPlus-i | 08/2021 | `192.168.10.117` | Production |
| 18 | `PIC-427725` | OmniPlus-i | 08/2021 | `192.168.10.118` | Production |
| 19 | `PIC-427726` | OmniPlus-i | 08/2021 | `192.168.10.119` | Production |
| 20 | `PIC-427727` | OmniPlus-i | 08/2021 | `192.168.10.120` | Production |
| 21 | `PIC-427728` | OmniPlus-i | 08/2021 | `192.168.10.121` | Production |
| 22 | `PIC-427729` | OmniPlus-i | 08/2021 | `192.168.10.122` | Production |
| 23 | `PIC-427730` | OmniPlus-i | 08/2021 | `192.168.10.123` | Production |
| 24 | `PIC-427731` | OmniPlus-i | 08/2021 | `192.168.10.124` | Production |
| 25 | `PIC-427732` | OmniPlus-i | 08/2021 | `192.168.10.125` | Production |

---

### 2. Picanol OmniPlus 800 (9 Looms, Shed Area B)
- **Year Recorded**: September 2005 - February 2006
- **Interface**: Picanol XP_CBMP_P9 Optocoupled
- **Default Speed**: 501 RPM
- **Default Weft Density**: 38.2 picks/cm

| Loom # | Machine ID | Model | Manufacturing Date | Static IP |
|---|---|---|---|---|
| 26 | `PIC-279327` | OmniPlus 800 | 09/2005 | `192.168.20.126` |
| 27 | `PIC-278863` | OmniPlus 800 | 09/2005 | `192.168.20.127` |
| 28 | `PIC-279323` | OmniPlus 800 | 09/2005 | `192.168.20.128` |
| 29 | `PIC-279105` | OmniPlus 800 | 09/2005 | `192.168.20.129` |
| 30 | `PIC-279099` | OmniPlus 800 | 09/2005 | `192.168.20.130` |
| 31 | `PIC-281560` | OmniPlus 800 | 02/2006 | `192.168.20.131` |
| 32 | `PIC-281554` | OmniPlus 800 | 02/2006 | `192.168.20.132` |
| 33 | `PIC-281553` | OmniPlus 800 | 02/2006 | `192.168.20.133` |
| 34 | `PIC-281481` | OmniPlus 800 | 02/2006 | `192.168.20.134` |

---

### 3. Picanol OmniPlus Summum (2 Looms, Shed Area C)
- **Year Recorded**: November 2012 / May 2015
- **Interface**: Picanol XP_CBMP_P9 Optocoupled + BICOM Ethernet
- **Default Speed**: 850 RPM
- **Default Weft Density**: 27.2 picks/cm

| Loom # | Machine ID | Model | Manufacturing Date | Static IP |
|---|---|---|---|---|
| 35 | `PIC-332235` | OmniPlus Summum | 11/2012 | `192.168.10.135` |
| 36 | `PIC-315816` | OmniPlus Summum | 05/2015 | `192.168.10.136` |
