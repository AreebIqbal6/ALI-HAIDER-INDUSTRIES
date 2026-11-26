/* In-memory NOR flash shim implementing ldl_flash_t for host tests. */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "ldl_flash.h"

typedef struct {
    uint8_t *mem;
    uint32_t size;
    uint32_t erases;
    uint32_t writes;
    uint32_t violations; /* writes that tried to set a 0 bit back to 1 */
    int fail_after;      /* >= 0: fail every write once this many more writes happened */
    ldl_flash_t flash;
} flash_shim_t;

void flash_shim_init(flash_shim_t *s, uint32_t size, uint32_t sector);
void flash_shim_free(flash_shim_t *s);
