/*
 * ldl_flash.h - minimal flash HAL used by the journal and outbox rings.
 * Semantics match NOR flash: erase sets a sector to 0xFF, writes can only
 * clear bits (1 -> 0). The ESP glue maps this to esp_partition_*; host tests
 * use an in-memory shim that enforces the same rules.
 */
#pragma once

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct ldl_flash {
    void *ctx;
    uint32_t size;        /* region size in bytes, multiple of sector_size */
    uint32_t sector_size; /* erase unit, 4096 on ESP32 */
    int (*read)(void *ctx, uint32_t off, void *buf, size_t len);        /* 0 = ok */
    int (*write)(void *ctx, uint32_t off, const void *buf, size_t len); /* 0 = ok */
    int (*erase)(void *ctx, uint32_t off, size_t len);                  /* sector aligned */
} ldl_flash_t;

#ifdef __cplusplus
}
#endif
