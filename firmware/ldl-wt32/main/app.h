/*
 * app.h - glue between the pure core and the ESP-IDF services: identity,
 * message publishing, shared status for LED/status page/health.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "freertos/FreeRTOS.h"
#include "ldl_classifier.h"
#include "ldl_contract.h"

#define APP_INPUTS 6 /* STRT, PP, WD, FD, LD, RES (raw GPIO view) */

typedef struct {
    /* identity */
    char device_id[13];
    char hostname[24];
    uint32_t boot_id;
    /* network */
    bool link_up;
    bool has_ip;
    bool static_ip_used;
    char ip[16];
    /* loom */
    bool raw_active[APP_INPUTS];
    uint64_t picks_total;
    ldl_phase_t phase;
    ldl_stop_cat_t cat;
    double rpm;
    /* storage */
    uint32_t backlog;
    uint32_t dropped;
    uint32_t journal_errors;
    /* uplink */
    bool uplink_ok;         /* last attempt succeeded */
    bool ever_uploaded;
    uint32_t batches_ok;
    uint32_t msgs_acked;
    uint32_t msgs_rejected;
    int last_http_status;   /* -1 = network error, 0 = never */
    int64_t last_uplink_ms; /* wall ms of last attempt */
    char last_uplink[96];
    char last_error[96];
} app_status_t;

/** Snapshot of the shared status (thread-safe copy). */
void app_status_get(app_status_t *out);

/** Mutate the shared status under its lock. */
#define APP_STATUS_UPDATE(stmt)            \
    do {                                   \
        app_status_t *const st = app_status_lock(); \
        stmt;                              \
        app_status_unlock();               \
    } while (0)

app_status_t *app_status_lock(void);
void app_status_unlock(void);

/** Record an error string (shown on status page, sent as health.lastError). */
void app_set_error(const char *fmt, ...) __attribute__((format(printf, 1, 2)));

/** Encode msg as an envelope (new msgId, next seq, ts=now) and queue it for the outbox. */
void app_publish(const ldl_msg_t *msg);

/** Generate a UUIDv7 for wall_ms using esp_random(). */
void app_uuid7(char out[LDL_UUID_LEN], int64_t wall_ms);

/** Start the loom task (inputs -> classifier -> publish). */
void loom_start(const ldl_cls_config_t *cfg, uint64_t picks_restored, uint64_t run_ms, uint64_t stop_ms,
                bool counters_lost);
