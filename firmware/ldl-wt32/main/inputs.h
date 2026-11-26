/*
 * inputs.h - loom signal capture.
 *  - GPIO4 pick pulses: PCNT unit (falling edges, glitch filter) accumulated
 *    into a 64-bit total; also a falling-edge ISR timestamp for rpm.
 *  - STRT/WD/FD/LD/RES: any-edge IRAM ISR pushing {channel, level, t_us}
 *    into a lock-free single-producer/single-consumer ring.
 * Debouncing happens in task context (loom task) via ldl_debounce.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"

typedef enum {
    INPUT_CH_STRT = 0,
    INPUT_CH_PP,
    INPUT_CH_WD,
    INPUT_CH_FD,
    INPUT_CH_LD,
    INPUT_CH_RES,
    INPUT_CH_COUNT,
} input_ch_t;

typedef struct {
    uint8_t ch;    /* input_ch_t */
    uint8_t level; /* raw GPIO level */
    int64_t t_us;  /* esp_timer time of the edge */
} input_evt_t;

esp_err_t inputs_init(uint64_t picks_base);

/** Pop one captured edge (consumer side, single task). */
bool inputs_pop(input_evt_t *e);

/** Events lost because the ring was full. */
uint32_t inputs_overruns(void);

/** Poll PCNT and return the 64-bit pick total (call from one task). */
uint64_t inputs_picks_total(void);

/** Current raw GPIO level of a channel. */
int inputs_raw_level(input_ch_t ch);

/** True if a raw GPIO level means "signal active" (active-low inputs). */
static inline bool inputs_is_active(int level)
{
    return level == 0;
}
