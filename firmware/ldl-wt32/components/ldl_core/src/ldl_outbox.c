#include "ldl_outbox.h"

#include <stddef.h>
#include <string.h>

#include "ldl_util.h"

#define HDR ((uint32_t)sizeof(ldl_outbox_hdr_t))
#define NONE UINT32_MAX
#define CRC_SPAN ((uint32_t)offsetof(ldl_outbox_hdr_t, flags)) /* magic, rid, boot_id, len */

static uint32_t rec_size(uint32_t len)
{
    return (HDR + len + 3u) & ~3u;
}

static uint32_t sec_size(const ldl_outbox_t *ob)
{
    return ob->flash->sector_size;
}

static uint32_t next_sector_start(const ldl_outbox_t *ob, uint32_t off)
{
    uint32_t n = (off / sec_size(ob) + 1) * sec_size(ob);
    return n >= ob->flash->size ? 0 : n;
}

static bool hdr_blank(const ldl_outbox_hdr_t *h)
{
    const uint8_t *p = (const uint8_t *)h;
    for (uint32_t i = 0; i < HDR; i++) {
        if (p[i] != 0xFF) {
            return false;
        }
    }
    return true;
}

/* Read and fully validate the record at off. */
static bool load(const ldl_outbox_t *ob, uint32_t off, ldl_outbox_hdr_t *h)
{
    const ldl_flash_t *f = ob->flash;
    const uint32_t in_sec = off % f->sector_size;
    if (off >= f->size || in_sec + HDR > f->sector_size) {
        return false;
    }
    if (f->read(f->ctx, off, h, HDR) != 0) {
        return false;
    }
    if (h->magic != LDL_OUTBOX_MAGIC || h->len == 0 || h->len > LDL_OUTBOX_MAX_PAYLOAD ||
        in_sec + rec_size(h->len) > f->sector_size) {
        return false;
    }
    uint32_t crc = ldl_crc32(0, h, CRC_SPAN);
    uint8_t chunk[64];
    uint32_t done = 0;
    while (done < h->len) {
        uint32_t n = h->len - done;
        if (n > sizeof(chunk)) {
            n = sizeof(chunk);
        }
        if (f->read(f->ctx, off + HDR + done, chunk, n) != 0) {
            return false;
        }
        crc = ldl_crc32(crc, chunk, n);
        done += n;
    }
    return crc == h->crc;
}

/* First valid record at or after off (in ring order), stopping at wp. */
static uint32_t seek(const ldl_outbox_t *ob, uint32_t off)
{
    const uint32_t nsec = ob->flash->size / sec_size(ob);
    ldl_outbox_hdr_t h;
    for (uint32_t i = 0; i <= nsec + 1; i++) {
        if (off == ob->wp) {
            return NONE;
        }
        if (load(ob, off, &h)) {
            return off;
        }
        /* Nothing valid between off and wp when wp is later in this sector. */
        if (off / sec_size(ob) == ob->wp / sec_size(ob) && ob->wp > off) {
            return NONE;
        }
        off = next_sector_start(ob, off);
    }
    return NONE;
}

static uint32_t advance(const ldl_outbox_t *ob, uint32_t off)
{
    ldl_outbox_hdr_t h;
    if (!load(ob, off, &h)) {
        return seek(ob, next_sector_start(ob, off));
    }
    uint32_t nxt = off + rec_size(h.len);
    if (nxt >= ob->flash->size) {
        nxt = 0;
    }
    return seek(ob, nxt);
}

static bool range_blank(const ldl_outbox_t *ob, uint32_t off, uint32_t end)
{
    uint8_t buf[64];
    while (off < end) {
        uint32_t n = end - off;
        if (n > sizeof(buf)) {
            n = sizeof(buf);
        }
        if (ob->flash->read(ob->flash->ctx, off, buf, n) != 0) {
            return false;
        }
        for (uint32_t i = 0; i < n; i++) {
            if (buf[i] != 0xFF) {
                return false;
            }
        }
        off += n;
    }
    return true;
}

uint32_t ldl_outbox_open(ldl_outbox_t *ob, const ldl_flash_t *flash)
{
    memset(ob, 0, sizeof(*ob));
    ob->flash = flash;
    const uint32_t S = flash->sector_size;
    const uint32_t nsec = flash->size / S;

    bool have_new = false, have_pend = false;
    uint32_t newest_rid = 0, newest_end = 0, oldest_rid = 0, oldest_off = 0;
    ldl_outbox_hdr_t h;

    for (uint32_t s = 0; s < nsec; s++) {
        uint32_t off = s * S;
        while (off - s * S + HDR <= S) {
            if (flash->read(flash->ctx, off, &h, HDR) != 0 || hdr_blank(&h)) {
                break;
            }
            if (!load(ob, off, &h)) {
                ob->corrupt++;
                break;
            }
            uint32_t end = off + rec_size(h.len);
            if (!have_new || (int32_t)(h.rid - newest_rid) > 0) {
                have_new = true;
                newest_rid = h.rid;
                newest_end = end;
            }
            if ((h.flags & LDL_OUTBOX_FLAG_PENDING) && (!have_pend || (int32_t)(h.rid - oldest_rid) < 0)) {
                have_pend = true;
                oldest_rid = h.rid;
                oldest_off = off;
            }
            off = end;
        }
    }

    if (!have_new) {
        ob->wp = 0;
        ob->rp = 0;
        ob->next_rid = 1;
        ob->count = 0;
        return 0;
    }

    ob->next_rid = newest_rid + 1;
    ob->wp = newest_end >= flash->size ? 0 : newest_end;
    if (ob->wp % S != 0) {
        uint32_t sec_end = (ob->wp / S + 1) * S;
        if (!range_blank(ob, ob->wp, sec_end)) {
            ob->wp = next_sector_start(ob, ob->wp);
        }
    }

    if (!have_pend) {
        ob->rp = ob->wp;
        ob->count = 0;
        return 0;
    }
    ob->rp = oldest_off;
    uint32_t n = 0;
    for (uint32_t off = oldest_off; off != NONE && n < 0x7FFFFFFF; off = advance(ob, off)) {
        n++;
    }
    ob->count = n;
    return n;
}

int ldl_outbox_append(ldl_outbox_t *ob, uint32_t boot_id, const void *data, uint16_t len)
{
    const ldl_flash_t *f = ob->flash;
    const uint32_t S = f->sector_size;
    if (len == 0 || len > LDL_OUTBOX_MAX_PAYLOAD) {
        return -1;
    }
    const uint32_t sz = rec_size(len);
    if ((ob->wp % S) + sz > S) {
        ob->wp = next_sector_start(ob, ob->wp);
    }
    if (ob->wp % S == 0) {
        const uint32_t target = ob->wp / S;
        if (ob->count > 0 && ob->rp / S == target) {
            uint32_t cur = ob->rp;
            while (ob->count > 0 && cur != NONE && cur / S == target) {
                cur = advance(ob, cur);
                ob->count--;
                ob->dropped++;
            }
            if (cur == NONE) {
                ob->count = 0;
            }
            ob->rp = ob->count ? cur : ob->wp;
        }
        if (f->erase(f->ctx, ob->wp, S) != 0) {
            ob->write_errors++;
            return -2;
        }
    }

    ldl_outbox_hdr_t h = {
        .magic = LDL_OUTBOX_MAGIC,
        .rid = ob->next_rid,
        .boot_id = boot_id,
        .len = len,
        .flags = 0xFFFF,
    };
    h.crc = ldl_crc32(ldl_crc32(0, &h, CRC_SPAN), data, len);

    /* Payload first, header last: a valid header implies a complete payload. */
    if (f->write(f->ctx, ob->wp + HDR, data, len) != 0 || f->write(f->ctx, ob->wp, &h, HDR) != 0) {
        ob->write_errors++;
        ob->wp = next_sector_start(ob, ob->wp); /* never reuse a dirty slot */
        if (ob->count == 0) {
            ob->rp = ob->wp;
        }
        return -3;
    }
    if (ob->count == 0) {
        ob->rp = ob->wp;
    }
    ob->count++;
    ob->next_rid++;
    ob->wp += sz;
    if (ob->wp >= f->size) {
        ob->wp = 0;
    }
    return 0;
}

static void fill_item(ldl_outbox_item_t *it, uint32_t off, const ldl_outbox_hdr_t *h)
{
    it->off = off;
    it->rid = h->rid;
    it->boot_id = h->boot_id;
    it->len = h->len;
}

bool ldl_outbox_first(ldl_outbox_t *ob, ldl_outbox_item_t *item)
{
    ldl_outbox_hdr_t h;
    while (ob->count > 0) {
        if (load(ob, ob->rp, &h)) {
            fill_item(item, ob->rp, &h);
            return true;
        }
        ob->corrupt++;
        ob->count--;
        uint32_t nxt = seek(ob, next_sector_start(ob, ob->rp));
        if (nxt == NONE) {
            ob->count = 0;
            ob->rp = ob->wp;
        } else {
            ob->rp = nxt;
        }
    }
    return false;
}

bool ldl_outbox_next(ldl_outbox_t *ob, const ldl_outbox_item_t *cur, ldl_outbox_item_t *next)
{
    uint32_t nxt = advance(ob, cur->off);
    ldl_outbox_hdr_t h;
    if (nxt == NONE || !load(ob, nxt, &h)) {
        return false;
    }
    fill_item(next, nxt, &h);
    return true;
}

int ldl_outbox_read(ldl_outbox_t *ob, const ldl_outbox_item_t *item, void *buf, uint32_t buflen)
{
    if (buflen < item->len) {
        return -1;
    }
    if (ob->flash->read(ob->flash->ctx, item->off + HDR, buf, item->len) != 0) {
        return -2;
    }
    if (buflen > item->len) {
        ((char *)buf)[item->len] = '\0';
    }
    return item->len;
}

uint32_t ldl_outbox_ack_through(ldl_outbox_t *ob, uint32_t last_rid)
{
    uint32_t n = 0;
    ldl_outbox_item_t it;
    while (ldl_outbox_first(ob, &it)) {
        if ((int32_t)(it.rid - last_rid) > 0) {
            break;
        }
        uint16_t flags = 0xFFFF & ~LDL_OUTBOX_FLAG_PENDING;
        if (ob->flash->write(ob->flash->ctx, it.off + offsetof(ldl_outbox_hdr_t, flags), &flags,
                             sizeof(flags)) != 0) {
            ob->write_errors++;
        }
        n++;
        ob->count--;
        uint32_t nxt = advance(ob, it.off);
        if (nxt == NONE || ob->count == 0) {
            ob->count = 0;
            ob->rp = ob->wp;
        } else {
            ob->rp = nxt;
        }
    }
    return n;
}
