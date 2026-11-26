/*
 * ldl_outbox.h - append-only flash ring of length-prefixed, CRC'd message
 * records (each record holds one encoded JSON envelope).
 *
 * Layout per record (4-byte aligned, never spans a sector):
 *   hdr {magic, rid, bootId, len, flags, crc} + payload + 0xFF padding
 * - rid is a monotonically increasing record id.
 * - flags is written as 0xFFFF; bit 0 is cleared in place (NOR 1->0) once the
 *   server answered stored/duplicate/rejected for the record. That in-place
 *   bit is the persisted read pointer: on boot the oldest record with the bit
 *   still set is where delivery resumes (replay).
 * - crc covers magic, rid, bootId, len and the payload (not flags).
 * - A sector is erased only when the write pointer enters it. If it still
 *   holds unacknowledged records (ring full) those are dropped and counted.
 *
 * Not thread-safe: the ESP glue serialises access with a mutex.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "ldl_flash.h"

#ifdef __cplusplus
extern "C" {
#endif

#define LDL_OUTBOX_MAGIC 0x3158424Fu /* "OBX1" */
#define LDL_OUTBOX_MAX_PAYLOAD 1536
#define LDL_OUTBOX_FLAG_PENDING 0x0001u /* 1 = not yet acknowledged */

typedef struct __attribute__((packed)) {
    uint32_t magic;
    uint32_t rid;
    uint32_t boot_id;
    uint16_t len;
    uint16_t flags;
    uint32_t crc;
} ldl_outbox_hdr_t;

_Static_assert(sizeof(ldl_outbox_hdr_t) == 20, "outbox header must be 20 bytes");

typedef struct {
    uint32_t off;
    uint32_t rid;
    uint32_t boot_id;
    uint16_t len;
} ldl_outbox_item_t;

typedef struct {
    const ldl_flash_t *flash;
    uint32_t wp;       /* next write offset */
    uint32_t rp;       /* offset of the oldest pending record (== wp when empty) */
    uint32_t next_rid; /* rid for the next append */
    uint32_t count;    /* pending (unacknowledged) records */
    uint32_t dropped;  /* records lost because the ring was full */
    uint32_t write_errors;
    uint32_t corrupt;  /* invalid records skipped */
} ldl_outbox_t;

/** Scan flash and rebuild pointers. Returns number of pending records. */
uint32_t ldl_outbox_open(ldl_outbox_t *ob, const ldl_flash_t *flash);

/** Append a payload. Returns 0 on success, <0 on error. */
int ldl_outbox_append(ldl_outbox_t *ob, uint32_t boot_id, const void *data, uint16_t len);

/** First pending record (oldest). */
bool ldl_outbox_first(ldl_outbox_t *ob, ldl_outbox_item_t *item);

/** Pending record after cur. */
bool ldl_outbox_next(ldl_outbox_t *ob, const ldl_outbox_item_t *cur, ldl_outbox_item_t *next);

/** Copy a record's payload into buf (NUL-terminated if room). Returns len or <0. */
int ldl_outbox_read(ldl_outbox_t *ob, const ldl_outbox_item_t *item, void *buf, uint32_t buflen);

/**
 * Acknowledge (delete) every pending record with rid <= last_rid, oldest
 * first. Records already dropped by overflow are skipped. Returns number acked.
 */
uint32_t ldl_outbox_ack_through(ldl_outbox_t *ob, uint32_t last_rid);

static inline uint32_t ldl_outbox_backlog(const ldl_outbox_t *ob)
{
    return ob->count;
}

#ifdef __cplusplus
}
#endif
