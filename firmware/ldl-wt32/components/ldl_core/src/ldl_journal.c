#include "ldl_journal.h"

#include <string.h>

#include "ldl_util.h"

#define REC_SIZE ((uint32_t)sizeof(ldl_journal_rec_t))

static bool rec_valid(const ldl_journal_rec_t *r)
{
    return r->magic == LDL_JOURNAL_MAGIC &&
           ldl_crc32(0, r, offsetof(ldl_journal_rec_t, crc)) == r->crc;
}

static bool rec_blank(const ldl_journal_rec_t *r)
{
    const uint8_t *p = (const uint8_t *)r;
    for (uint32_t i = 0; i < REC_SIZE; i++) {
        if (p[i] != 0xFF) {
            return false;
        }
    }
    return true;
}

bool ldl_journal_open(ldl_journal_t *j, const ldl_flash_t *flash)
{
    memset(j, 0, sizeof(*j));
    j->flash = flash;
    const uint32_t slots = flash->size / REC_SIZE;
    uint32_t best_off = 0;
    ldl_journal_rec_t rec;

    for (uint32_t i = 0; i < slots; i++) {
        if (flash->read(flash->ctx, i * REC_SIZE, &rec, REC_SIZE) != 0) {
            continue;
        }
        if (!rec_valid(&rec)) {
            continue;
        }
        /* seq comparison tolerant to 32-bit wrap */
        if (!j->have_last || (int32_t)(rec.seq - j->last.seq) > 0) {
            j->have_last = true;
            j->last = rec;
            best_off = i * REC_SIZE;
        }
    }

    if (!j->have_last) {
        j->next_off = 0;
        j->next_seq = 1;
        return false;
    }

    j->next_seq = j->last.seq + 1;
    uint32_t off = best_off + REC_SIZE;
    if (off >= flash->size) {
        off = 0;
    }
    /* If the slot after the newest record is not blank (torn write or stale
     * data) and it is mid-sector, skip to the next sector boundary so the
     * next append erases cleanly. */
    if (off % flash->sector_size != 0) {
        if (flash->read(flash->ctx, off, &rec, REC_SIZE) != 0 || !rec_blank(&rec)) {
            off = (off / flash->sector_size + 1) * flash->sector_size;
            if (off >= flash->size) {
                off = 0;
            }
        }
    }
    j->next_off = off;
    return true;
}

int ldl_journal_append(ldl_journal_t *j, uint32_t boot_id, uint64_t picks_total, uint32_t run_ms,
                       uint32_t stop_ms)
{
    const ldl_flash_t *f = j->flash;
    ldl_journal_rec_t rec = {
        .magic = LDL_JOURNAL_MAGIC,
        .boot_id = boot_id,
        .seq = j->next_seq,
        .picks_total = picks_total,
        .run_ms = run_ms,
        .stop_ms = stop_ms,
    };
    rec.crc = ldl_crc32(0, &rec, offsetof(ldl_journal_rec_t, crc));

    if (j->next_off % f->sector_size == 0) {
        if (f->erase(f->ctx, j->next_off, f->sector_size) != 0) {
            j->write_errors++;
            return -1;
        }
    }
    int rc = f->write(f->ctx, j->next_off, &rec, REC_SIZE);
    /* Advance even on failure so a bad slot is not retried forever. */
    j->next_off += REC_SIZE;
    if (j->next_off + REC_SIZE > f->size) {
        j->next_off = 0;
    }
    j->next_seq++;
    if (rc != 0) {
        j->write_errors++;
        return -1;
    }
    j->last = rec;
    j->have_last = true;
    return 0;
}
