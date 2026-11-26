/*
 * ota.h - HTTPS OTA with rollback (CONFIG_BOOTLOADER_APP_ROLLBACK_ENABLE).
 * A freshly flashed OTA image boots in PENDING_VERIFY state; it is marked
 * valid after the first successful batch upload. If it crashes/reboots
 * before that, the bootloader rolls back to the previous image.
 */
#pragma once

#include "esp_err.h"

/** Mark the running image valid (idempotent; call after a successful upload). */
void ota_mark_valid_once(void);

/** Download and install an image from url, then reboot. Runs in a background task. */
esp_err_t ota_start(const char *url);
