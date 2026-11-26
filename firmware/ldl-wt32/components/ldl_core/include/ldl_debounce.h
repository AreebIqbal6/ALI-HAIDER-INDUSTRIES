/*
 * ldl_debounce.h - time-based debouncer fed with raw (ISR-captured) edges.
 * A new level is accepted once the raw signal has stayed at it for
 * debounce_us; the reported edge time is when that stable run began.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    bool stable;   /* debounced level */
    bool raw;      /* last raw level seen */
    bool pending;  /* raw != stable, waiting for it to settle */
    int64_t since_us;
    uint32_t debounce_us;
} ldl_debounce_t;

static inline void ldl_deb_init(ldl_debounce_t *d, bool level, uint32_t debounce_us)
{
    d->stable = level;
    d->raw = level;
    d->pending = false;
    d->since_us = 0;
    d->debounce_us = debounce_us;
}

/** Raw level observation at t_us (edge from ISR or a periodic resync sample). */
static inline void ldl_deb_feed(ldl_debounce_t *d, bool level, int64_t t_us)
{
    if (level == d->raw) {
        return;
    }
    d->raw = level;
    if (level == d->stable) {
        d->pending = false;
    } else {
        d->pending = true;
        d->since_us = t_us;
    }
}

/** Returns true (and the new level/edge time) when a debounced edge completes. */
static inline bool ldl_deb_poll(ldl_debounce_t *d, int64_t now_us, bool *level, int64_t *edge_us)
{
    if (!d->pending || now_us - d->since_us < (int64_t)d->debounce_us) {
        return false;
    }
    d->pending = false;
    d->stable = d->raw;
    *level = d->stable;
    *edge_us = d->since_us;
    return true;
}

#ifdef __cplusplus
}
#endif
