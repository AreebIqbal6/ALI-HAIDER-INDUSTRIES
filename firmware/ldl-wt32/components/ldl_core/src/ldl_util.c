#include "ldl_util.h"

#include <stdio.h>
#include <string.h>

uint32_t ldl_crc32(uint32_t crc, const void *data, size_t len)
{
    const uint8_t *p = (const uint8_t *)data;
    crc = ~crc;
    while (len--) {
        crc ^= *p++;
        for (int k = 0; k < 8; k++) {
            crc = (crc >> 1) ^ (0xEDB88320u & (0u - (crc & 1u)));
        }
    }
    return ~crc;
}

/* Howard Hinnant's civil-from-days / days-from-civil (proleptic Gregorian). */
static void civil_from_days(int64_t z, int *y, unsigned *m, unsigned *d)
{
    z += 719468;
    const int64_t era = (z >= 0 ? z : z - 146096) / 146097;
    const unsigned doe = (unsigned)(z - era * 146097);
    const unsigned yoe = (doe - doe / 1460 + doe / 36524 - doe / 146096) / 365;
    const int64_t yy = (int64_t)yoe + era * 400;
    const unsigned doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    const unsigned mp = (5 * doy + 2) / 153;
    *d = doy - (153 * mp + 2) / 5 + 1;
    *m = mp < 10 ? mp + 3 : mp - 9;
    *y = (int)(yy + (*m <= 2));
}

static int64_t days_from_civil(int y, unsigned m, unsigned d)
{
    y -= m <= 2;
    const int64_t era = (y >= 0 ? y : y - 399) / 400;
    const unsigned yoe = (unsigned)(y - era * 400);
    const unsigned doy = (153 * (m > 2 ? m - 3 : m + 9) + 2) / 5 + d - 1;
    const unsigned doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    return era * 146097 + (int64_t)doe - 719468;
}

void ldl_iso_format(int64_t unix_ms, char *out)
{
    int64_t days = unix_ms / 86400000;
    int64_t rem = unix_ms % 86400000;
    if (rem < 0) {
        rem += 86400000;
        days -= 1;
    }
    int y;
    unsigned mo, d;
    civil_from_days(days, &y, &mo, &d);
    unsigned ms = (unsigned)(rem % 1000);
    unsigned secs = (unsigned)(rem / 1000);
    char tmp[64]; /* roomy: the compiler cannot prove field ranges */
    snprintf(tmp, sizeof(tmp), "%04d-%02u-%02uT%02u:%02u:%02u.%03uZ", y % 10000, mo % 100, d % 100,
             (secs / 3600) % 100, (secs / 60) % 60, secs % 60, ms);
    memcpy(out, tmp, LDL_ISO_LEN - 1);
    out[LDL_ISO_LEN - 1] = '\0';
}

static bool parse_uint(const char **p, int digits, unsigned *v)
{
    unsigned r = 0;
    for (int i = 0; i < digits; i++) {
        char c = (*p)[i];
        if (c < '0' || c > '9') {
            return false;
        }
        r = r * 10 + (unsigned)(c - '0');
    }
    *p += digits;
    *v = r;
    return true;
}

static bool expect(const char **p, char c)
{
    if (**p != c) {
        return false;
    }
    (*p)++;
    return true;
}

bool ldl_iso_parse(const char *s, int64_t *unix_ms)
{
    if (!s) {
        return false;
    }
    const char *p = s;
    unsigned y, mo, d, h, mi, se, ms = 0;
    if (!parse_uint(&p, 4, &y) || !expect(&p, '-') || !parse_uint(&p, 2, &mo) || !expect(&p, '-') ||
        !parse_uint(&p, 2, &d) || !(expect(&p, 'T') || expect(&p, ' ')) || !parse_uint(&p, 2, &h) ||
        !expect(&p, ':') || !parse_uint(&p, 2, &mi) || !expect(&p, ':') || !parse_uint(&p, 2, &se)) {
        return false;
    }
    if (*p == '.') {
        p++;
        unsigned scale = 100;
        while (*p >= '0' && *p <= '9') {
            ms += (unsigned)(*p - '0') * scale;
            scale /= 10;
            p++;
        }
    }
    if (*p != 'Z' && *p != 'z') {
        return false;
    }
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || se > 60) {
        return false;
    }
    int64_t days = days_from_civil((int)y, mo, d);
    *unix_ms = ((days * 86400 + h * 3600 + mi * 60 + se) * 1000) + ms;
    return true;
}

void ldl_uuid7_format(char *out, uint64_t unix_ms, const uint8_t rnd[10])
{
    uint8_t b[16];
    b[0] = (uint8_t)(unix_ms >> 40);
    b[1] = (uint8_t)(unix_ms >> 32);
    b[2] = (uint8_t)(unix_ms >> 24);
    b[3] = (uint8_t)(unix_ms >> 16);
    b[4] = (uint8_t)(unix_ms >> 8);
    b[5] = (uint8_t)(unix_ms);
    b[6] = (uint8_t)(0x70 | (rnd[0] & 0x0F));
    b[7] = rnd[1];
    b[8] = (uint8_t)(0x80 | (rnd[2] & 0x3F));
    memcpy(&b[9], &rnd[3], 7);
    static const char hex[] = "0123456789abcdef";
    int o = 0;
    for (int i = 0; i < 16; i++) {
        if (i == 4 || i == 6 || i == 8 || i == 10) {
            out[o++] = '-';
        }
        out[o++] = hex[b[i] >> 4];
        out[o++] = hex[b[i] & 0xF];
    }
    out[o] = '\0';
}

static int hexval(char c)
{
    if (c >= '0' && c <= '9') {
        return c - '0';
    }
    if (c >= 'a' && c <= 'f') {
        return c - 'a' + 10;
    }
    return -1;
}

bool ldl_uuid7_valid(const char *s)
{
    if (!s || strlen(s) != 36) {
        return false;
    }
    for (int i = 0; i < 36; i++) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (s[i] != '-') {
                return false;
            }
        } else if (hexval(s[i]) < 0) {
            return false;
        }
    }
    if (s[14] != '7') {
        return false;
    }
    int v = hexval(s[19]);
    return v >= 8 && v <= 0xb;
}

uint64_t ldl_uuid7_ms(const char *s)
{
    uint64_t ms = 0;
    for (int i = 0; i < 13; i++) {
        if (i == 8) {
            continue;
        }
        int v = hexval(s[i]);
        if (v < 0) {
            return 0;
        }
        ms = (ms << 4) | (uint64_t)v;
    }
    return ms;
}
