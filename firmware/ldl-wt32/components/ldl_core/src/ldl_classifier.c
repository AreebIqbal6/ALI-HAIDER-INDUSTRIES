#include "ldl_classifier.h"

#include <string.h>

#define NEVER_US (INT64_MIN / 4)
#define STEP_THRESHOLD_MS 2000

static int64_t floor_div(int64_t a, int64_t b)
{
    int64_t q = a / b;
    if ((a % b != 0) && ((a < 0) != (b < 0))) {
        q--;
    }
    return q;
}

int64_t ldl_cls_wall(const ldl_cls_t *c, int64_t t_us)
{
    return c->wall_ref_ms + floor_div(t_us - c->mono_ref_us, 1000);
}

static void emit(ldl_cls_t *c, const ldl_msg_t *m)
{
    if (c->hal.emit) {
        c->hal.emit(c->hal.ctx, m);
    }
}

void ldl_cls_state(const ldl_cls_t *c, ldl_state_data_t *out)
{
    memset(out, 0, sizeof(*out));
    out->running = c->phase == LDL_PHASE_RUNNING;
    out->cat = out->running ? LDL_CAT_NONE : c->cat;
    if (!out->running) {
        memcpy(out->stop_id, c->stop_id, LDL_UUID_LEN);
    }
    out->since_ms = ldl_cls_wall(c, c->since_us);
    out->rpm = out->running ? c->rpm : 0.0;
    out->picks_total = c->picks_total;
}

static void emit_state(ldl_cls_t *c, int64_t now_us)
{
    ldl_msg_t m = {.type = LDL_MSG_STATE};
    ldl_cls_state(c, &m.u.state);
    c->last_state_us = now_us;
    emit(c, &m);
}

/* ---------------- time accounting / counters window ---------------- */

static void add_time(ldl_cls_t *c, uint64_t dt_us)
{
    if (c->level[LDL_IN_STRT]) {
        c->win_run_us += dt_us;
        c->run_us_frac += dt_us;
        c->total_run_ms += c->run_us_frac / 1000;
        c->run_us_frac %= 1000;
    } else {
        c->win_stop_us += dt_us;
        c->stop_us_frac += dt_us;
        c->total_stop_ms += c->stop_us_frac / 1000;
        c->stop_us_frac %= 1000;
    }
}

static void begin_window(ldl_cls_t *c, int64_t now_us, int64_t wall_ms)
{
    const int64_t w = c->cfg.window_ms;
    const int64_t ws = floor_div(wall_ms, w) * w;
    c->win_start_ms = ws;
    c->win_start_us = now_us - (wall_ms - ws) * 1000;
    c->win_end_us = c->win_start_us + w * 1000;
    c->win_offline_us = (uint64_t)(now_us - c->win_start_us);
    c->win_run_us = 0;
    c->win_stop_us = 0;
    c->win_run_picks = 0;
    c->win_picks_start = c->picks_total;
    memset(c->win_stops, 0, sizeof(c->win_stops));
}

static uint32_t us_to_ms(uint64_t us)
{
    return (uint32_t)((us + 500) / 1000);
}

static void close_window(ldl_cls_t *c, int64_t end_ms)
{
    ldl_msg_t m = {.type = LDL_MSG_COUNTERS};
    ldl_counters_t *k = &m.u.counters;
    k->window_start_ms = c->win_start_ms;
    k->window_end_ms = end_ms;
    k->picks_total = c->picks_total;
    k->picks_delta = c->picks_total - c->win_picks_start;
    const int64_t len = end_ms - c->win_start_ms;
    k->offline_ms = us_to_ms(c->win_offline_us);
    k->run_ms = us_to_ms(c->win_run_us);
    if ((int64_t)k->offline_ms > len) {
        k->offline_ms = (uint32_t)(len > 0 ? len : 0);
    }
    if ((int64_t)k->run_ms + k->offline_ms > len) {
        k->run_ms = (uint32_t)(len - k->offline_ms);
    }
    k->stop_ms = (uint32_t)(len - k->run_ms - k->offline_ms);
    memcpy(k->stops, c->win_stops, sizeof(k->stops));
    k->rpm_avg_running = k->run_ms ? (double)c->win_run_picks * 60000.0 / (double)k->run_ms : 0.0;
    emit(c, &m);
}

/* Account time up to t_us, closing every window boundary crossed. */
static void account(ldl_cls_t *c, int64_t t_us)
{
    if (t_us <= c->acc_us) {
        return;
    }
    while (t_us >= c->win_end_us) {
        add_time(c, (uint64_t)(c->win_end_us - c->acc_us));
        c->acc_us = c->win_end_us;
        close_window(c, c->win_start_ms + c->cfg.window_ms);
        /* next window, contiguous in the mono domain */
        c->win_start_ms += c->cfg.window_ms;
        c->win_start_us = c->win_end_us;
        c->win_end_us += (int64_t)c->cfg.window_ms * 1000;
        c->win_offline_us = 0;
        c->win_run_us = 0;
        c->win_stop_us = 0;
        c->win_run_picks = 0;
        c->win_picks_start = c->picks_total;
        memset(c->win_stops, 0, sizeof(c->win_stops));
    }
    add_time(c, (uint64_t)(t_us - c->acc_us));
    c->acc_us = t_us;
}

/* ---------------- classification ---------------- */

static ldl_stop_cat_t category_from(const bool hit[LDL_IN_COUNT])
{
    if (hit[LDL_IN_FD]) {
        return LDL_CAT_FILLING;
    }
    if (hit[LDL_IN_WD]) {
        return LDL_CAT_WARP;
    }
    if (hit[LDL_IN_LD]) {
        return LDL_CAT_SELVEDGE;
    }
    return LDL_CAT_OTHER;
}

static void finalize(ldl_cls_t *c, int64_t now_us)
{
    c->cat = category_from(c->hit);
    c->phase = LDL_PHASE_STOPPED;
    c->since_us = c->stop_us;
    if (!c->boot_stop) {
        c->win_stops[c->cat]++;
    }
    ldl_msg_t m = {.type = LDL_MSG_STOP_STARTED};
    memcpy(m.u.stop_started.stop_id, c->stop_id, LDL_UUID_LEN);
    m.u.stop_started.cat = c->cat;
    m.u.stop_started.detected_ms = ldl_cls_wall(c, c->stop_us);
    m.u.stop_started.picks_total = c->picks_total;
    emit(c, &m);
    emit_state(c, now_us);
}

static void confirm_run(ldl_cls_t *c, int64_t now_us)
{
    ldl_msg_t m = {.type = LDL_MSG_STOP_ENDED};
    memcpy(m.u.stop_ended.stop_id, c->stop_id, LDL_UUID_LEN);
    m.u.stop_ended.cat = c->cat;
    m.u.stop_ended.duration_ms = (c->attempt_us - c->stop_us) / 1000;
    m.u.stop_ended.failed_attempts = c->failed_attempts;
    m.u.stop_ended.picks_total = c->attempt_picks;
    emit(c, &m);

    c->phase = LDL_PHASE_RUNNING;
    c->since_us = c->attempt_us;
    c->attempt_active = false;
    c->stop_id[0] = '\0';
    c->cat = LDL_CAT_NONE;
    c->failed_attempts = 0;
    c->boot_stop = false;
    emit_state(c, now_us);
}

static void clear_rpm(ldl_cls_t *c)
{
    c->n_periods = 0;
    c->period_idx = 0;
    c->rpm = 0.0;
}

static void begin_stop(ldl_cls_t *c, int64_t t_us)
{
    c->phase = LDL_PHASE_CLASSIFYING;
    c->stop_us = t_us;
    c->since_us = t_us;
    c->failed_attempts = 0;
    c->attempt_active = false;
    c->boot_stop = false;
    c->cat = LDL_CAT_NONE;
    if (c->hal.uuid) {
        c->hal.uuid(c->hal.ctx, c->stop_id, ldl_cls_wall(c, t_us));
    }
    const int64_t from = t_us - (int64_t)c->cfg.pre_ms * 1000;
    for (int i = 0; i < LDL_IN_COUNT; i++) {
        c->hit[i] = c->level[i] || c->last_off_us[i] >= from;
    }
    c->hit[LDL_IN_STRT] = false;
    clear_rpm(c);
}

static void on_stop_edge(ldl_cls_t *c, int64_t t_us)
{
    if (c->phase == LDL_PHASE_STOPPED && c->attempt_active) {
        const uint64_t picks = c->picks_total - c->attempt_picks;
        if (picks > c->cfg.failed_start_picks) {
            /* the run was real but the confirming tick has not happened yet */
            confirm_run(c, t_us);
            begin_stop(c, t_us);
            return;
        }
        c->failed_attempts++;
        c->attempt_active = false;
        ldl_msg_t m = {.type = LDL_MSG_START_FAILED};
        memcpy(m.u.start_failed.stop_id, c->stop_id, LDL_UUID_LEN);
        m.u.start_failed.cat = c->cat;
        m.u.start_failed.detected_ms = ldl_cls_wall(c, t_us);
        m.u.start_failed.attempt = c->failed_attempts;
        m.u.start_failed.picks_in_attempt = (uint32_t)picks;
        m.u.start_failed.picks_total = c->picks_total;
        emit(c, &m);
        clear_rpm(c);
        return;
    }
    if (c->phase == LDL_PHASE_RUNNING) {
        begin_stop(c, t_us);
    }
}

static void on_run_edge(ldl_cls_t *c, int64_t t_us)
{
    if (c->phase == LDL_PHASE_CLASSIFYING) {
        finalize(c, t_us);
    }
    if (c->phase == LDL_PHASE_STOPPED) {
        c->attempt_active = true;
        c->attempt_us = t_us;
        c->attempt_picks = c->picks_total;
        clear_rpm(c);
        if (c->cfg.failed_start_picks == 0) {
            confirm_run(c, t_us);
        }
    }
}

/* ---------------- public API ---------------- */

void ldl_cls_init(ldl_cls_t *c, const ldl_cls_config_t *cfg, const ldl_cls_hal_t *hal)
{
    memset(c, 0, sizeof(*c));
    c->cfg = *cfg;
    if (c->cfg.window_ms == 0) {
        c->cfg.window_ms = 60000;
    }
    if (c->cfg.state_interval_ms == 0) {
        c->cfg.state_interval_ms = 60000;
    }
    if (c->cfg.rpm_timeout_ms == 0) {
        c->cfg.rpm_timeout_ms = 2000;
    }
    c->hal = *hal;
    c->cat = LDL_CAT_NONE;
    c->last_pick_us = NEVER_US;
    for (int i = 0; i < LDL_IN_COUNT; i++) {
        c->last_on_us[i] = NEVER_US;
        c->last_off_us[i] = NEVER_US;
    }
}

void ldl_cls_restore(ldl_cls_t *c, uint64_t picks_total, uint64_t run_ms, uint64_t stop_ms)
{
    c->picks_total = picks_total;
    c->tick_picks = picks_total;
    c->total_run_ms = run_ms;
    c->total_stop_ms = stop_ms;
}

void ldl_cls_start(ldl_cls_t *c, int64_t now_us, int64_t wall_ms, const bool levels[LDL_IN_COUNT])
{
    c->mono_ref_us = now_us;
    c->wall_ref_ms = wall_ms;
    for (int i = 0; i < LDL_IN_COUNT; i++) {
        c->level[i] = levels[i];
        if (levels[i]) {
            c->last_on_us[i] = now_us;
        }
    }
    c->acc_us = now_us;
    c->tick_picks = c->picks_total;
    begin_window(c, now_us, wall_ms);
    c->started = true;

    if (c->level[LDL_IN_STRT]) {
        c->phase = LDL_PHASE_RUNNING;
        c->since_us = now_us;
        emit_state(c, now_us);
        return;
    }
    /* Idle at boot: open a stop with whatever the stop inputs say now. */
    c->phase = LDL_PHASE_CLASSIFYING;
    begin_stop(c, now_us);
    c->boot_stop = true;
    finalize(c, now_us);
}

void ldl_cls_input(ldl_cls_t *c, ldl_input_t in, bool active, int64_t t_us)
{
    if (in >= LDL_IN_COUNT || c->level[in] == active) {
        return;
    }
    if (in == LDL_IN_STRT && c->started) {
        account(c, t_us);
    }
    c->level[in] = active;
    if (active) {
        c->last_on_us[in] = t_us;
    } else {
        c->last_off_us[in] = t_us;
    }
    if (!c->started) {
        return;
    }
    if (in == LDL_IN_STRT) {
        if (active) {
            on_run_edge(c, t_us);
        } else {
            on_stop_edge(c, t_us);
        }
        return;
    }
    if (active && c->phase == LDL_PHASE_CLASSIFYING &&
        t_us <= c->stop_us + (int64_t)c->cfg.post_ms * 1000) {
        c->hit[in] = true;
    }
}

void ldl_cls_pick(ldl_cls_t *c, int64_t t_us)
{
    if (c->last_pick_us != NEVER_US) {
        int64_t dt = t_us - c->last_pick_us;
        if (dt > 0 && dt <= (int64_t)c->cfg.rpm_timeout_ms * 1000) {
            c->periods_us[c->period_idx] = (uint32_t)dt;
            c->period_idx = (uint8_t)((c->period_idx + 1) % LDL_RPM_PERIODS);
            if (c->n_periods < LDL_RPM_PERIODS) {
                c->n_periods++;
            }
        }
    }
    c->last_pick_us = t_us;
    if (c->n_periods) {
        uint64_t sum = 0;
        for (int i = 0; i < c->n_periods; i++) {
            sum += c->periods_us[i];
        }
        c->rpm = 60e6 * c->n_periods / (double)sum;
    }
}

void ldl_cls_tick(ldl_cls_t *c, int64_t now_us, int64_t wall_ms, uint64_t picks_total)
{
    if (!c->started) {
        return;
    }
    /* picks first so a window closed below includes them */
    uint64_t dp = picks_total - c->tick_picks;
    c->tick_picks = picks_total;
    c->picks_total = picks_total;
    if (c->level[LDL_IN_STRT]) {
        c->win_run_picks += dp;
    }

    const int64_t expected = ldl_cls_wall(c, now_us);
    const int64_t step = wall_ms - expected;
    account(c, now_us);
    if (step > STEP_THRESHOLD_MS || step < -STEP_THRESHOLD_MS) {
        /* Wall clock stepped (SNTP / server time). Close early and realign. */
        close_window(c, c->win_start_ms + (now_us - c->win_start_us) / 1000);
        c->mono_ref_us = now_us;
        c->wall_ref_ms = wall_ms;
        begin_window(c, now_us, wall_ms);
    } else {
        c->mono_ref_us = now_us;
        c->wall_ref_ms = wall_ms;
    }

    if (c->phase == LDL_PHASE_CLASSIFYING && now_us >= c->stop_us + (int64_t)c->cfg.post_ms * 1000) {
        finalize(c, now_us);
    }
    if (c->phase == LDL_PHASE_STOPPED && c->attempt_active &&
        c->picks_total - c->attempt_picks > c->cfg.failed_start_picks) {
        confirm_run(c, now_us);
    }
    if (c->last_pick_us != NEVER_US && now_us - c->last_pick_us > (int64_t)c->cfg.rpm_timeout_ms * 1000) {
        clear_rpm(c);
    }
    if (c->phase != LDL_PHASE_CLASSIFYING &&
        now_us - c->last_state_us >= (int64_t)c->cfg.state_interval_ms * 1000) {
        emit_state(c, now_us);
    }
}
