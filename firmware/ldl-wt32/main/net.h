/*
 * net.h - Ethernet (LAN8720 on WT32-ETH01) with DHCP and optional static
 * IP fallback from NVS config. Hostname "ldl-<mac>".
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

/** Read the Ethernet MAC (efuse) as 12 lowercase hex chars. */
void net_device_id(char out[13]);

/** Bring up esp_netif + EMAC + PHY and start DHCP. */
esp_err_t net_init(const char *hostname);
