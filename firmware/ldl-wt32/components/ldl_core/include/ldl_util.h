/*
 * ldl_util.h - small pure-C helpers shared by the LDL core (no ESP deps).
 *   - CRC-32 (IEEE 802.3, reflected, same as zlib/esp_rom_crc32_le)
 *   - ISO-8601 UTC formatting/parsing with milliseconds
 *   - UUIDv7 formatting
 */
#pragma once

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/** CRC-32/ISO-HDLC. Pass crc=0 for a fresh computation; chainable. */
uint32_t ldl_crc32(uint32_t crc, const void *data, size_t len);

#define LDL_ISO_LEN 25 /* "2026-11-26T09:15:02.481Z" + NUL */

/** Format unix milliseconds as "YYYY-MM-DDTHH:MM:SS.mmmZ". out >= LDL_ISO_LEN. */
void ldl_iso_format(int64_t unix_ms, char *out);

/** Parse "YYYY-MM-DDTHH:MM:SS[.fff]Z" into unix ms. Returns false on error. */
bool ldl_iso_parse(const char *s, int64_t *unix_ms);

#define LDL_UUID_LEN 37 /* 36 chars + NUL */

/**
 * Format a UUIDv7: 48-bit big-endian unix ms, version nibble 7, 12 random
 * bits, variant 0b10, 62 random bits. rnd must hold 10 random bytes.
 */
void ldl_uuid7_format(char *out, uint64_t unix_ms, const uint8_t rnd[10]);

/** True if s is a canonical lowercase UUIDv7 string. */
bool ldl_uuid7_valid(const char *s);

/** Extract unix ms from a UUIDv7 string (no validation beyond hex). */
uint64_t ldl_uuid7_ms(const char *s);

#ifdef __cplusplus
}
#endif
