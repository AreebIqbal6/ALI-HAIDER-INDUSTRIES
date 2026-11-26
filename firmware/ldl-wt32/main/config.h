/*
 * config.h - runtime configuration: Kconfig defaults overridden by NVS
 * values set from the serial console (`set <key> <value>`).
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#include "esp_err.h"

typedef struct {
    char url[160];     /* backend base URL */
    char token[256];   /* device bearer token (secret) */
    char machine[33];  /* machineId */
    char ntp[64];      /* SNTP server */
    char static_ip[16];
    char gateway[16];
    char netmask[16];
    char dns[16];
} ldl_cfg_t;

/** Load defaults and NVS overrides. Call after nvs_flash_init(). */
void cfg_load(void);

/** Thread-safe copy of the current config. */
void cfg_get(ldl_cfg_t *out);

/** Copy just the machine id (cheap; used for every envelope). */
void cfg_get_machine(char *out, size_t len);

/** Set and persist a key. Empty value clears the override. */
esp_err_t cfg_set(const char *key, const char *value);

/** Increment and return the persisted boot counter. */
uint32_t cfg_next_boot_id(void);

/** Start the UART console (set/get/show/reboot/ota/status). */
void cfg_console_start(void);
