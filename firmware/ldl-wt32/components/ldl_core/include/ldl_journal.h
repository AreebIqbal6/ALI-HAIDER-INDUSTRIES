/*
 * ldl_journal.h - append-only ring of fixed 32-byte counter records.
 *
 * Record: {magic, bootId, seq, picksTotal(64), runMs, stopMs, crc32}.
 * seq increases monotonically across the whole ring; on boot the record with
 * the highest seq and a valid CRC wins. A 4 KB sector is erased only when the
 * write position wraps into it.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "ldl_flash.h"

#ifdef __cplusplus
extern "C" {
#endif

#define LDL_JOURNAL_MAGIC 0x4C4A5231u /* "LJR1" */

typedef struct __attribute__((packed)) {
    uint32_t magic;
    uint32_t boot_id;
    uint32_t seq;
    uint64_t picks_total;
    uint32_t run_ms;  /* cumulative running time, wraps at 2^32 */
    uint32_t stop_ms; /* cumulative stopped time, wraps at 2^32 */
    uint32_t crc;     /* CRC-32 over the preceding 28 bytes */
} ldl_journal_rec_t;

_Static_assert(sizeof(ldl_journal_rec_t) == 32, "journal record must be 32 bytes");

typedef struct {
    const ldl_flash_t *flash;
    uint32_t next_off; /* where the next record goes */
    uint32_t next_seq;
    bool have_last;
    ldl_journal_rec_t last; /* newest valid record (restored or written) */
    uint32_t write_errors;
} ldl_journal_t;

/** Scan the region and locate the newest valid record. Returns true if one was found. */
bool ldl_journal_open(ldl_journal_t *j, const ldl_flash_t *flash);

/** Append a record. Returns 0 on success. */
int ldl_journal_append(ldl_journal_t *j, uint32_t boot_id, uint64_t picks_total, uint32_t run_ms,
                       uint32_t stop_ms);

#ifdef __cplusplus
}
#endif
