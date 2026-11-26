#include "flash_shim.h"

#include <stdlib.h>
#include <string.h>

static int shim_read(void *ctx, uint32_t off, void *buf, size_t len)
{
    flash_shim_t *s = ctx;
    if (off + len > s->size) {
        return -1;
    }
    memcpy(buf, s->mem + off, len);
    return 0;
}

static int shim_write(void *ctx, uint32_t off, const void *buf, size_t len)
{
    flash_shim_t *s = ctx;
    if (off + len > s->size) {
        return -1;
    }
    if (s->fail_after == 0) {
        return -1;
    }
    if (s->fail_after > 0) {
        s->fail_after--;
    }
    const uint8_t *src = buf;
    for (size_t i = 0; i < len; i++) {
        uint8_t old = s->mem[off + i];
        if ((old & src[i]) != src[i]) {
            s->violations++;
        }
        s->mem[off + i] = old & src[i]; /* NOR: only 1 -> 0 */
    }
    s->writes++;
    return 0;
}

static int shim_erase(void *ctx, uint32_t off, size_t len)
{
    flash_shim_t *s = ctx;
    if (off % s->flash.sector_size || len % s->flash.sector_size || off + len > s->size) {
        return -1;
    }
    memset(s->mem + off, 0xFF, len);
    s->erases++;
    return 0;
}

void flash_shim_init(flash_shim_t *s, uint32_t size, uint32_t sector)
{
    memset(s, 0, sizeof(*s));
    s->mem = malloc(size);
    memset(s->mem, 0xFF, size);
    s->size = size;
    s->fail_after = -1;
    s->flash.ctx = s;
    s->flash.size = size;
    s->flash.sector_size = sector;
    s->flash.read = shim_read;
    s->flash.write = shim_write;
    s->flash.erase = shim_erase;
}

void flash_shim_free(flash_shim_t *s)
{
    free(s->mem);
    s->mem = NULL;
}
