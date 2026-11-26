/*
 * ldl_classifier.h - loom run/stop state machine, stop classification and
 * per-minute counters. Pure C; time comes in as monotonic microseconds and is
 * converted to wall-clock ms through the HAL so it can be unit tested.
 *
 * Inputs are logical (true = signal active, i.e. opto ON / GPIO LOW).
 *  - STRT active          -> loom running.
 *  - STRT active -> idle  -> stop edge. Category decided from WD/FD/LD being
 *    active anywhere in [edge - pre_ms, edge + post_ms]; priority
 *    FILLING > WARP > SELVEDGE > OTHER.
 *  - A restart that stops again before more than failed_start_picks picks is a
 *    failed start attempt (START_ATTEMPT_FAILED); the stop continues.
 *  - A run is confirmed (STOP_ENDED + state RUNNING) once more than
 *    failed_start_picks picks have been counted since STRT became active.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "ldl_contract.h"

#ifdef __cplusplus
extern "C" {
#endif

typedef enum {
    LDL_IN_STRT = 0, /* IN1 running */
    LDL_IN_WD,       /* IN3 warp stop */
    LDL_IN_FD,       /* IN4 filling stop */
    LDL_IN_LD,       /* IN5 selvedge stop */
    LDL_IN_RES,      /* IN6 reserve (logged only) */
    LDL_IN_COUNT,
} ldl_input_t;

typedef struct {
    uint32_t pre_ms;             /* classification window before stop edge (300) */
    uint32_t post_ms;            /* classification window after stop edge (1000) */
    uint32_t failed_start_picks; /* run must exceed this many picks (5) */
    uint32_t state_interval_ms;  /* periodic state message (60000) */
    uint32_t window_ms;          /* counters window (60000) */
    uint32_t rpm_timeout_ms;     /* no pick for this long -> rpm 0 (2000) */
} ldl_cls_config_t;

#define LDL_CLS_CONFIG_DEFAULT                                                                      \
    {                                                                                               \
        .pre_ms = 300, .post_ms = 1000, .failed_start_picks = 5, .state_interval_ms = 60000,        \
        .window_ms = 60000, .rpm_timeout_ms = 2000,                                                 \
    }

typedef struct {
    void *ctx;
    /* Generate a UUIDv7 for wall-clock ms. */
    void (*uuid)(void *ctx, char out[LDL_UUID_LEN], int64_t wall_ms);
    /* Deliver a message (state/event/counters). The msg is only valid during the call. */
    void (*emit)(void *ctx, const ldl_msg_t *msg);
} ldl_cls_hal_t;

typedef enum {
    LDL_PHASE_RUNNING = 0,
    LDL_PHASE_CLASSIFYING, /* stop edge seen, waiting for the post window */
    LDL_PHASE_STOPPED,
} ldl_phase_t;

#define LDL_RPM_PERIODS 8

typedef struct {
    ldl_cls_config_t cfg;
    ldl_cls_hal_t hal;

    /* clock mapping: wall_ms = (t_us - mono_ref_us)/1000 + wall_ref_ms */
    int64_t mono_ref_us;
    int64_t wall_ref_ms;

    /* inputs */
    bool level[LDL_IN_COUNT];
    int64_t last_on_us[LDL_IN_COUNT];
    int64_t last_off_us[LDL_IN_COUNT];

    /* logical state */
    ldl_phase_t phase;
    int64_t since_us;
    char stop_id[LDL_UUID_LEN];
    ldl_stop_cat_t cat;
    int64_t stop_us;
    bool hit[LDL_IN_COUNT];
    bool boot_stop; /* stop inherited at boot: not counted in stops{} */
    uint32_t failed_attempts;
    bool attempt_active;
    int64_t attempt_us;
    uint64_t attempt_picks;
    int64_t last_state_us;

    /* picks / rpm */
    uint64_t picks_total;
    int64_t last_pick_us;
    uint32_t periods_us[LDL_RPM_PERIODS];
    uint8_t n_periods, period_idx;
    double rpm;

    /* time accounting */
    int64_t acc_us; /* time accounted up to here */
    uint64_t total_run_ms, total_stop_ms;
    uint64_t run_us_frac, stop_us_frac; /* sub-ms carry for totals */

    /* counters window (mono domain is authoritative) */
    int64_t win_start_ms; /* wall */
    int64_t win_start_us; /* mono at window start (may be before start()) */
    int64_t win_end_us;   /* mono at window end */
    uint64_t win_picks_start;
    uint64_t win_run_us, win_stop_us, win_offline_us;
    uint64_t win_run_picks;
    uint32_t win_stops[LDL_CAT_COUNT];
    uint64_t tick_picks; /* picks_total at previous tick */
    bool started;
} ldl_cls_t;

void ldl_cls_init(ldl_cls_t *c, const ldl_cls_config_t *cfg, const ldl_cls_hal_t *hal);

/** Restore persisted lifetime counters (from the journal) before start(). */
void ldl_cls_restore(ldl_cls_t *c, uint64_t picks_total, uint64_t run_ms, uint64_t stop_ms);

/**
 * Begin operation. levels[] are the current debounced input levels. Emits the
 * initial state (and STOP_STARTED with category OTHER if the loom is idle).
 */
void ldl_cls_start(ldl_cls_t *c, int64_t now_us, int64_t wall_ms, const bool levels[LDL_IN_COUNT]);

/** Debounced edge on a logical input at t_us (in time order). */
void ldl_cls_input(ldl_cls_t *c, ldl_input_t in, bool active, int64_t t_us);

/** One pick pulse observed at t_us (for rpm; the count comes via tick). */
void ldl_cls_pick(ldl_cls_t *c, int64_t t_us);

/**
 * Periodic tick (~10-100 ms). picks_total is the authoritative hardware
 * counter. wall_ms is the current wall clock; a step > 2 s versus the mono
 * clock closes the current counters window early and realigns.
 */
void ldl_cls_tick(ldl_cls_t *c, int64_t now_us, int64_t wall_ms, uint64_t picks_total);

/** Wall-clock ms for a mono timestamp using the classifier's clock mapping. */
int64_t ldl_cls_wall(const ldl_cls_t *c, int64_t t_us);

/** Fill a state message for the current state. */
void ldl_cls_state(const ldl_cls_t *c, ldl_state_data_t *out);

#ifdef __cplusplus
}
#endif
