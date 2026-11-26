/* Classifier scenarios driven by a small loom simulator. */
#include <stdio.h>
#include <string.h>

#include "ldl_classifier.h"
#include "unity.h"

#define MAX_OUT 64
#define TICK_US 10000
#define WALL_09_16 1795684560000LL /* 2026-11-26T09:16:00.000Z */

typedef struct {
    ldl_cls_t cls;
    ldl_msg_t out[MAX_OUT];
    int n_out;
    int64_t now_us;
    int64_t wall0_ms; /* wall = wall0 + now_us/1000 */
    uint64_t picks;
    int64_t next_pick_us;
    uint32_t uuid_n;
} sim_t;

static void hal_uuid(void *ctx, char out[LDL_UUID_LEN], int64_t wall_ms)
{
    sim_t *s = ctx;
    uint8_t r[10] = {0};
    s->uuid_n++;
    memcpy(&r[3], &s->uuid_n, sizeof(s->uuid_n));
    ldl_uuid7_format(out, (uint64_t)wall_ms, r);
}

static void hal_emit(void *ctx, const ldl_msg_t *m)
{
    sim_t *s = ctx;
    TEST_ASSERT_TRUE_MESSAGE(s->n_out < MAX_OUT, "too many outputs");
    s->out[s->n_out++] = *m;
}

static int64_t wall(const sim_t *s)
{
    return s->wall0_ms + s->now_us / 1000;
}

static void sim_init(sim_t *s, bool running, uint32_t state_interval_ms)
{
    memset(s, 0, sizeof(*s));
    ldl_cls_config_t cfg = LDL_CLS_CONFIG_DEFAULT;
    cfg.state_interval_ms = state_interval_ms;
    ldl_cls_hal_t hal = {.ctx = s, .uuid = hal_uuid, .emit = hal_emit};
    ldl_cls_init(&s->cls, &cfg, &hal);
    s->now_us = 1000000; /* boot 1 s after mono zero */
    s->wall0_ms = WALL_09_16 - 2000; /* boot at 09:15:59.000 */
    s->picks = 1000;
    ldl_cls_restore(&s->cls, s->picks, 0, 0);
    bool lv[LDL_IN_COUNT] = {0};
    lv[LDL_IN_STRT] = running;
    ldl_cls_start(&s->cls, s->now_us, wall(s), lv);
    s->next_pick_us = s->now_us + 66667;
}

/* Advance time; while `picking`, one pick every period_us. */
static void sim_run(sim_t *s, int64_t dur_us, bool picking, int64_t period_us)
{
    const int64_t end = s->now_us + dur_us;
    while (s->now_us < end) {
        int64_t step = end - s->now_us < TICK_US ? end - s->now_us : TICK_US;
        int64_t t1 = s->now_us + step;
        if (picking) {
            while (s->next_pick_us <= t1) {
                s->picks++;
                ldl_cls_pick(&s->cls, s->next_pick_us);
                s->next_pick_us += period_us;
            }
        } else {
            s->next_pick_us = t1 + period_us;
        }
        s->now_us = t1;
        ldl_cls_tick(&s->cls, s->now_us, wall(s), s->picks);
    }
}

static void sim_edge(sim_t *s, ldl_input_t in, bool active)
{
    ldl_cls_input(&s->cls, in, active, s->now_us);
}

static int count_type(const sim_t *s, ldl_msg_type_t t)
{
    int n = 0;
    for (int i = 0; i < s->n_out; i++) {
        n += s->out[i].type == t;
    }
    return n;
}

static const ldl_msg_t *find(const sim_t *s, ldl_msg_type_t t, int nth)
{
    for (int i = 0; i < s->n_out; i++) {
        if (s->out[i].type == t && nth-- == 0) {
            return &s->out[i];
        }
    }
    return NULL;
}

static const ldl_msg_t *last_of(const sim_t *s, ldl_msg_type_t t)
{
    for (int i = s->n_out - 1; i >= 0; i--) {
        if (s->out[i].type == t) {
            return &s->out[i];
        }
    }
    return NULL;
}

/* Run 5 s, then stop with the given input pattern, wait 2 s. Returns stop wall ms. */
static int64_t do_stop(sim_t *s, ldl_input_t pre_in, int64_t pre_offset_us, ldl_input_t post_in,
                       int64_t post_offset_us)
{
    sim_run(s, 5000000 - (pre_in != LDL_IN_COUNT ? pre_offset_us : 0), true, 66667);
    if (pre_in != LDL_IN_COUNT) {
        sim_edge(s, pre_in, true);
        sim_run(s, pre_offset_us, true, 66667);
    }
    sim_edge(s, LDL_IN_STRT, false);
    int64_t stop_wall = wall(s);
    if (post_in != LDL_IN_COUNT) {
        sim_run(s, post_offset_us, false, 66667);
        sim_edge(s, post_in, true);
    }
    sim_run(s, 2000000, false, 66667);
    return stop_wall;
}

static void assert_stop(const sim_t *s, ldl_stop_cat_t cat, int64_t stop_wall)
{
    const ldl_msg_t *e = find(s, LDL_MSG_STOP_STARTED, 0);
    TEST_ASSERT_NOT_NULL(e);
    TEST_ASSERT_EQUAL_STRING(ldl_cat_name(cat), ldl_cat_name(e->u.stop_started.cat));
    TEST_ASSERT_EQUAL_INT64(stop_wall, e->u.stop_started.detected_ms);
    TEST_ASSERT_TRUE(ldl_uuid7_valid(e->u.stop_started.stop_id));
    const ldl_msg_t *st = last_of(s, LDL_MSG_STATE);
    TEST_ASSERT_FALSE(st->u.state.running);
    TEST_ASSERT_EQUAL_INT(cat, st->u.state.cat);
    TEST_ASSERT_EQUAL_STRING(e->u.stop_started.stop_id, st->u.state.stop_id);
    TEST_ASSERT_EQUAL_INT64(stop_wall, st->u.state.since_ms);
    TEST_ASSERT_EQUAL_DOUBLE(0.0, st->u.state.rpm);
}

static void test_boot_running_emits_state(void)
{
    sim_t s;
    sim_init(&s, true, 60000);
    TEST_ASSERT_EQUAL_INT(1, s.n_out);
    TEST_ASSERT_EQUAL_INT(LDL_MSG_STATE, s.out[0].type);
    TEST_ASSERT_TRUE(s.out[0].u.state.running);
    TEST_ASSERT_EQUAL_INT(LDL_CAT_NONE, s.out[0].u.state.cat);
    sim_run(&s, 3000000, true, 66667);
    /* rpm from pick period: 66.667 ms -> 900 rpm */
    ldl_state_data_t st;
    ldl_cls_state(&s.cls, &st);
    TEST_ASSERT_DOUBLE_WITHIN(0.5, 900.0, st.rpm);
}

static void test_warp_stop(void)
{
    sim_t s;
    sim_init(&s, true, 600000);
    /* drop wire falls 100 ms before STRT goes idle */
    int64_t stop_wall = do_stop(&s, LDL_IN_WD, 100000, LDL_IN_COUNT, 0);
    assert_stop(&s, LDL_CAT_WARP, stop_wall);
    TEST_ASSERT_EQUAL_INT(1, count_type(&s, LDL_MSG_STOP_STARTED));
}

static void test_filling_beats_warp(void)
{
    sim_t s;
    sim_init(&s, true, 600000);
    /* WD before the edge, FD 400 ms after: FILLING has priority */
    int64_t stop_wall = do_stop(&s, LDL_IN_WD, 200000, LDL_IN_FD, 400000);
    assert_stop(&s, LDL_CAT_FILLING, stop_wall);
}

static void test_selvedge_stop_after_edge(void)
{
    sim_t s;
    sim_init(&s, true, 600000);
    int64_t stop_wall = do_stop(&s, LDL_IN_COUNT, 0, LDL_IN_LD, 900000);
    assert_stop(&s, LDL_CAT_SELVEDGE, stop_wall);
}

static void test_operator_stop_is_other(void)
{
    sim_t s;
    sim_init(&s, true, 600000);
    int64_t stop_wall = do_stop(&s, LDL_IN_COUNT, 0, LDL_IN_COUNT, 0);
    assert_stop(&s, LDL_CAT_OTHER, stop_wall);
}

static void test_inputs_outside_window_ignored(void)
{
    sim_t s;
    sim_init(&s, true, 600000);
    /* WD pulse ends 400 ms before stop (outside 300 ms pre-window) */
    sim_run(&s, 4000000, true, 66667);
    sim_edge(&s, LDL_IN_WD, true);
    sim_run(&s, 100000, true, 66667);
    sim_edge(&s, LDL_IN_WD, false);
    sim_run(&s, 400000, true, 66667);
    sim_edge(&s, LDL_IN_STRT, false);
    int64_t stop_wall = wall(&s);
    /* FD arrives 1.2 s after (outside +1000 ms post-window) */
    sim_run(&s, 1200000, false, 66667);
    sim_edge(&s, LDL_IN_FD, true);
    sim_run(&s, 1000000, false, 66667);
    assert_stop(&s, LDL_CAT_OTHER, stop_wall);
}

static void test_pulse_inside_pre_window_counts(void)
{
    sim_t s;
    sim_init(&s, true, 600000);
    sim_run(&s, 4000000, true, 66667);
    sim_edge(&s, LDL_IN_WD, true);
    sim_run(&s, 50000, true, 66667);
    sim_edge(&s, LDL_IN_WD, false); /* released 250 ms before the stop */
    sim_run(&s, 250000, true, 66667);
    sim_edge(&s, LDL_IN_STRT, false);
    int64_t stop_wall = wall(&s);
    sim_run(&s, 1500000, false, 66667);
    assert_stop(&s, LDL_CAT_WARP, stop_wall);
}

static void test_failed_start_then_restart(void)
{
    sim_t s;
    sim_init(&s, true, 600000);
    int64_t stop_wall = do_stop(&s, LDL_IN_COUNT, 0, LDL_IN_FD, 100000);
    assert_stop(&s, LDL_CAT_FILLING, stop_wall);
    uint64_t picks_at_stop = s.picks;

    /* attempt 1: 3 picks then stops again */
    sim_run(&s, 10000000, false, 66667);
    sim_edge(&s, LDL_IN_STRT, true);
    s.next_pick_us = s.now_us + 50000;
    sim_run(&s, 200000, true, 66667); /* 3 picks */
    TEST_ASSERT_EQUAL_UINT64(picks_at_stop + 3, s.picks);
    sim_edge(&s, LDL_IN_STRT, false);
    sim_run(&s, 3000000, false, 66667);
    TEST_ASSERT_EQUAL_INT(1, count_type(&s, LDL_MSG_START_FAILED));
    const ldl_msg_t *f = find(&s, LDL_MSG_START_FAILED, 0);
    TEST_ASSERT_EQUAL_UINT32(1, f->u.start_failed.attempt);
    TEST_ASSERT_EQUAL_UINT32(3, f->u.start_failed.picks_in_attempt);
    TEST_ASSERT_EQUAL_INT(LDL_CAT_FILLING, f->u.start_failed.cat);
    TEST_ASSERT_EQUAL_INT(0, count_type(&s, LDL_MSG_STOP_ENDED));
    TEST_ASSERT_EQUAL_INT(1, count_type(&s, LDL_MSG_STOP_STARTED)); /* same stop */

    /* attempt 2: real run */
    sim_edge(&s, LDL_IN_STRT, true);
    int64_t restart_wall = wall(&s);
    uint64_t picks_at_restart = s.picks;
    s.next_pick_us = s.now_us + 50000;
    sim_run(&s, 2000000, true, 66667);
    TEST_ASSERT_EQUAL_INT(1, count_type(&s, LDL_MSG_STOP_ENDED));
    const ldl_msg_t *e = find(&s, LDL_MSG_STOP_ENDED, 0);
    TEST_ASSERT_EQUAL_STRING(f->u.start_failed.stop_id, e->u.stop_ended.stop_id);
    TEST_ASSERT_EQUAL_UINT32(1, e->u.stop_ended.failed_attempts);
    TEST_ASSERT_EQUAL_INT64(restart_wall - stop_wall, e->u.stop_ended.duration_ms);
    TEST_ASSERT_EQUAL_UINT64(picks_at_restart, e->u.stop_ended.picks_total);
    const ldl_msg_t *st = last_of(&s, LDL_MSG_STATE);
    TEST_ASSERT_TRUE(st->u.state.running);
    TEST_ASSERT_EQUAL_INT64(restart_wall, st->u.state.since_ms);
    TEST_ASSERT_TRUE(st->u.state.rpm > 800.0);
}

static void test_counters_window(void)
{
    sim_t s;
    sim_init(&s, true, 600000); /* boot at 09:15:59.000 running */
    /* first (partial) window closes at 09:16:00 with 1 s offline */
    sim_run(&s, 1000000, true, 66667);
    const ldl_msg_t *c0 = find(&s, LDL_MSG_COUNTERS, 0);
    TEST_ASSERT_NOT_NULL(c0);
    TEST_ASSERT_EQUAL_INT64(WALL_09_16 - 60000, c0->u.counters.window_start_ms);
    TEST_ASSERT_EQUAL_INT64(WALL_09_16, c0->u.counters.window_end_ms);
    TEST_ASSERT_EQUAL_UINT32(59000, c0->u.counters.offline_ms);
    TEST_ASSERT_EQUAL_UINT32(1000, c0->u.counters.run_ms);

    /* 09:16:00 - 09:17:00: run 30 s @ 900 rpm, warp stop 30 s */
    uint64_t p0 = s.picks;
    sim_run(&s, 29900000, true, 66667);
    sim_edge(&s, LDL_IN_WD, true);
    sim_run(&s, 100000, true, 66667);
    sim_edge(&s, LDL_IN_STRT, false);
    sim_run(&s, 30000000, false, 66667);
    const ldl_msg_t *c1 = find(&s, LDL_MSG_COUNTERS, 1);
    TEST_ASSERT_NOT_NULL(c1);
    const ldl_counters_t *k = &c1->u.counters;
    TEST_ASSERT_EQUAL_INT64(WALL_09_16, k->window_start_ms);
    TEST_ASSERT_EQUAL_INT64(WALL_09_16 + 60000, k->window_end_ms);
    TEST_ASSERT_EQUAL_UINT32(30000, k->run_ms);
    TEST_ASSERT_EQUAL_UINT32(30000, k->stop_ms);
    TEST_ASSERT_EQUAL_UINT32(0, k->offline_ms);
    TEST_ASSERT_EQUAL_UINT32(60000, k->run_ms + k->stop_ms + k->offline_ms);
    TEST_ASSERT_UINT64_WITHIN(1, 450, k->picks_delta);
    TEST_ASSERT_EQUAL_UINT64(p0 + k->picks_delta, k->picks_total);
    TEST_ASSERT_EQUAL_UINT32(1, k->stops[LDL_CAT_WARP]);
    TEST_ASSERT_EQUAL_UINT32(0, k->stops[LDL_CAT_OTHER]);
    TEST_ASSERT_DOUBLE_WITHIN(2.0, 900.0, k->rpm_avg_running);
}

static void test_periodic_state_and_clock_step(void)
{
    sim_t s;
    sim_init(&s, false, 60000); /* boot idle -> STOP_STARTED OTHER + state */
    TEST_ASSERT_EQUAL_INT(1, count_type(&s, LDL_MSG_STOP_STARTED));
    TEST_ASSERT_EQUAL_INT(1, count_type(&s, LDL_MSG_STATE));
    sim_run(&s, 125000000, false, 66667);
    TEST_ASSERT_EQUAL_INT(3, count_type(&s, LDL_MSG_STATE)); /* +60 s, +120 s */
    /* boot stop is not counted in stops{} */
    const ldl_msg_t *c = find(&s, LDL_MSG_COUNTERS, 1);
    TEST_ASSERT_EQUAL_UINT32(0, c->u.counters.stops[LDL_CAT_OTHER]);
    TEST_ASSERT_EQUAL_UINT32(60000, c->u.counters.stop_ms);

    /* wall clock steps +1 h (SNTP): window closed early and realigned */
    int n_before = count_type(&s, LDL_MSG_COUNTERS);
    s.wall0_ms += 3600000 + 30000;
    sim_run(&s, 10000, false, 66667);
    TEST_ASSERT_EQUAL_INT(n_before + 1, count_type(&s, LDL_MSG_COUNTERS));
    const ldl_msg_t *early = last_of(&s, LDL_MSG_COUNTERS);
    const ldl_counters_t *k = &early->u.counters;
    TEST_ASSERT_TRUE(k->window_end_ms - k->window_start_ms < 60000);
    TEST_ASSERT_EQUAL_INT64(k->window_end_ms - k->window_start_ms, k->run_ms + k->stop_ms + k->offline_ms);
    /* next window is aligned on the new clock */
    TEST_ASSERT_EQUAL_INT64(0, s.cls.win_start_ms % 60000);
    TEST_ASSERT_TRUE(s.cls.win_start_ms > k->window_end_ms + 3500000);
}

void run_classifier_tests(void)
{
    RUN_TEST(test_boot_running_emits_state);
    RUN_TEST(test_warp_stop);
    RUN_TEST(test_filling_beats_warp);
    RUN_TEST(test_selvedge_stop_after_edge);
    RUN_TEST(test_operator_stop_is_other);
    RUN_TEST(test_inputs_outside_window_ignored);
    RUN_TEST(test_pulse_inside_pre_window_counts);
    RUN_TEST(test_failed_start_then_restart);
    RUN_TEST(test_counters_window);
    RUN_TEST(test_periodic_state_and_clock_step);
}
