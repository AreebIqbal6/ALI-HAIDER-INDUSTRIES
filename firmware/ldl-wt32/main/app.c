/*
 * app.c - shared status, envelope publishing and the loom task
 * (ISR ring -> debounce -> classifier -> outbox queue).
 */
#include "app.h"

#include <stdarg.h>
#include <stdio.h>
#include <string.h>

#include "esp_log.h"
#include "esp_random.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "freertos/task.h"
#include "ldl_debounce.h"
#include "sdkconfig.h"

#include "board_wt32_eth01.h"
#include "config.h"
#include "inputs.h"
#include "store.h"
#include "timesync.h"

static const char *TAG = "loom";

/* ---------------- shared status ---------------- */

static app_status_t s_status;
static portMUX_TYPE s_status_mux = portMUX_INITIALIZER_UNLOCKED;

app_status_t *app_status_lock(void)
{
    taskENTER_CRITICAL(&s_status_mux);
    return &s_status;
}

void app_status_unlock(void)
{
    taskEXIT_CRITICAL(&s_status_mux);
}

void app_status_get(app_status_t *out)
{
    taskENTER_CRITICAL(&s_status_mux);
    *out = s_status;
    taskEXIT_CRITICAL(&s_status_mux);
}

void app_set_error(const char *fmt, ...)
{
    char msg[96];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof(msg), fmt, ap);
    va_end(ap);
    APP_STATUS_UPDATE(strlcpy(st->last_error, msg, sizeof(st->last_error)));
}

/* ---------------- publishing ---------------- */

static uint32_t s_seq;
static portMUX_TYPE s_seq_mux = portMUX_INITIALIZER_UNLOCKED;

void app_uuid7(char out[LDL_UUID_LEN], int64_t wall_ms)
{
    uint8_t rnd[10];
    esp_fill_random(rnd, sizeof(rnd));
    ldl_uuid7_format(out, (uint64_t)(wall_ms < 0 ? 0 : wall_ms), rnd);
}

void app_publish(const ldl_msg_t *msg)
{
    ldl_meta_t meta = {0};
    meta.ts_ms = timesync_now_ms(&meta.synced);
    app_uuid7(meta.msg_id, meta.ts_ms);
    taskENTER_CRITICAL(&s_seq_mux);
    meta.seq = ++s_seq; /* restarts at 1 every boot */
    taskEXIT_CRITICAL(&s_seq_mux);

    char machine[33];
    cfg_get_machine(machine, sizeof(machine));

    app_status_t st;
    app_status_get(&st);
    const ldl_identity_t id = {.device_id = st.device_id, .machine_id = machine, .boot_id = st.boot_id};
    char *json = ldl_contract_encode(&id, &meta, msg);
    if (!json) {
        app_set_error("encode failed (type %d)", (int)msg->type);
        return;
    }
    ESP_LOGD(TAG, "publish %s", json);
    store_enqueue(json);
}

/* ---------------- loom task ---------------- */

#define LOOP_MS 10
#define RESYNC_MS 100

static ldl_cls_t s_cls;
static ldl_debounce_t s_deb[INPUT_CH_COUNT];

static const int8_t CH_TO_IN[INPUT_CH_COUNT] = {
    [INPUT_CH_STRT] = LDL_IN_STRT, [INPUT_CH_PP] = -1,       [INPUT_CH_WD] = LDL_IN_WD,
    [INPUT_CH_FD] = LDL_IN_FD,     [INPUT_CH_LD] = LDL_IN_LD, [INPUT_CH_RES] = LDL_IN_RES,
};

static void cls_uuid(void *ctx, char out[LDL_UUID_LEN], int64_t wall_ms)
{
    app_uuid7(out, wall_ms);
}

static void cls_emit(void *ctx, const ldl_msg_t *m)
{
    app_publish(m);
}

typedef struct {
    ldl_input_t in;
    bool active;
    int64_t t_us;
} edge_t;

static void loom_task(void *arg)
{
    esp_task_wdt_add(NULL);
    int64_t last_pick_us = INT64_MIN / 2;
    int64_t last_resync_us = 0;
    TickType_t wake = xTaskGetTickCount();

    for (;;) {
        const int64_t now = esp_timer_get_time();

        input_evt_t ev;
        while (inputs_pop(&ev)) {
            if (ev.ch == INPUT_CH_PP) {
                if (ev.t_us - last_pick_us >= BOARD_PICK_MIN_PERIOD_US) {
                    ldl_cls_pick(&s_cls, ev.t_us);
                    last_pick_us = ev.t_us;
                }
            } else if (ev.ch < INPUT_CH_COUNT) {
                ldl_deb_feed(&s_deb[ev.ch], inputs_is_active(ev.level), ev.t_us);
            }
        }
        /* resync against the pins in case the ring overflowed */
        if (now - last_resync_us >= RESYNC_MS * 1000) {
            last_resync_us = now;
            for (int ch = 0; ch < INPUT_CH_COUNT; ch++) {
                if (CH_TO_IN[ch] >= 0) {
                    bool a = inputs_is_active(inputs_raw_level((input_ch_t)ch));
                    if (a != s_deb[ch].raw) {
                        ldl_deb_feed(&s_deb[ch], a, now);
                    }
                }
            }
        }

        edge_t edges[INPUT_CH_COUNT];
        int ne = 0;
        for (int ch = 0; ch < INPUT_CH_COUNT; ch++) {
            bool lvl;
            int64_t t;
            if (CH_TO_IN[ch] >= 0 && ldl_deb_poll(&s_deb[ch], now, &lvl, &t)) {
                edges[ne++] = (edge_t){.in = (ldl_input_t)CH_TO_IN[ch], .active = lvl, .t_us = t};
            }
        }
        /* deliver in time order (insertion sort, n <= 5) */
        for (int i = 1; i < ne; i++) {
            edge_t k = edges[i];
            int j = i - 1;
            while (j >= 0 && edges[j].t_us > k.t_us) {
                edges[j + 1] = edges[j];
                j--;
            }
            edges[j + 1] = k;
        }
        for (int i = 0; i < ne; i++) {
            ESP_LOGI(TAG, "input %d -> %s", (int)edges[i].in, edges[i].active ? "ON" : "off");
            ldl_cls_input(&s_cls, edges[i].in, edges[i].active, edges[i].t_us);
        }

        const uint64_t picks = inputs_picks_total();
        ldl_cls_tick(&s_cls, now, timesync_now_ms(NULL), picks);
        store_journal_snapshot(picks, s_cls.total_run_ms, s_cls.total_stop_ms);

        APP_STATUS_UPDATE({
            for (int ch = 0; ch < INPUT_CH_COUNT; ch++) {
                st->raw_active[ch] = ch == INPUT_CH_PP ? inputs_is_active(inputs_raw_level(INPUT_CH_PP))
                                                       : s_deb[ch].stable;
            }
            st->picks_total = picks;
            st->phase = s_cls.phase;
            st->cat = s_cls.cat;
            st->rpm = s_cls.phase == LDL_PHASE_RUNNING ? s_cls.rpm : 0.0;
        });

        esp_task_wdt_reset();
        vTaskDelayUntil(&wake, pdMS_TO_TICKS(LOOP_MS));
    }
}

void loom_start(const ldl_cls_config_t *cfg, uint64_t picks_restored, uint64_t run_ms, uint64_t stop_ms,
                bool counters_lost)
{
    const ldl_cls_hal_t hal = {.ctx = NULL, .uuid = cls_uuid, .emit = cls_emit};
    ldl_cls_init(&s_cls, cfg, &hal);
    ldl_cls_restore(&s_cls, picks_restored, run_ms, stop_ms);

    bool levels[LDL_IN_COUNT] = {0};
    const int64_t now = esp_timer_get_time();
    for (int ch = 0; ch < INPUT_CH_COUNT; ch++) {
        bool a = inputs_is_active(inputs_raw_level((input_ch_t)ch));
        ldl_deb_init(&s_deb[ch], a, CONFIG_LDL_DEBOUNCE_MS * 1000);
        if (CH_TO_IN[ch] >= 0) {
            levels[CH_TO_IN[ch]] = a;
        }
    }
    const int64_t wall = timesync_now_ms(NULL);
    if (counters_lost) {
        ldl_msg_t m = {.type = LDL_MSG_DISCONTINUITY};
        m.u.discontinuity.detected_ms = wall;
        m.u.discontinuity.reason = "COUNTERS_LOST";
        m.u.discontinuity.picks_total = picks_restored;
        app_publish(&m);
    }
    ldl_cls_start(&s_cls, now, wall, levels);
    ESP_LOGI(TAG, "classifier started: %s, picks %llu", levels[LDL_IN_STRT] ? "RUNNING" : "STOPPED",
             (unsigned long long)picks_restored);
    xTaskCreatePinnedToCore(loom_task, "loom", 6144, NULL, 10, NULL, 1);
}
