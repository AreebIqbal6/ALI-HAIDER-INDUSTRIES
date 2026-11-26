#include "uplink.h"

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_log.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"

#include "app.h"
#include "config.h"
#include "led.h"
#include "ldl_contract.h"
#include "ota.h"
#include "store.h"
#include "timesync.h"

static const char *TAG = "uplink";

#define BODY_CAP (24 * 1024)
#define RESP_CAP (8 * 1024)
#define HTTP_TIMEOUT_MS 10000
#define AUTH_PAUSE_MS (5 * 60 * 1000)
#define INGEST_PATH "/api/ingest/v1/batch"

static char s_body[BODY_CAP];
static store_batch_entry_t s_ents[LDL_MAX_BATCH];
static ldl_result_t s_results[LDL_MAX_BATCH];

typedef struct {
    int status;   /* HTTP status or -1 for transport error */
    int resp_len;
    char *resp;
} http_result_t;

static void set_result(int status, const char *fmt, ...) __attribute__((format(printf, 2, 3)));
static void set_result(int status, const char *fmt, ...)
{
    char msg[96];
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(msg, sizeof(msg), fmt, ap);
    va_end(ap);
    const int64_t now = timesync_now_ms(NULL);
    APP_STATUS_UPDATE({
        st->last_http_status = status;
        st->last_uplink_ms = now;
        strlcpy(st->last_uplink, msg, sizeof(st->last_uplink));
    });
}

static http_result_t post(const char *url, const char *token, const char *body, int len)
{
    http_result_t r = {.status = -1};
    esp_http_client_config_t cfg = {
        .url = url,
        .method = HTTP_METHOD_POST,
        .timeout_ms = HTTP_TIMEOUT_MS,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .buffer_size = 2048,
        .buffer_size_tx = 1024,
        .disable_auto_redirect = true,
    };
    esp_http_client_handle_t c = esp_http_client_init(&cfg);
    if (!c) {
        return r;
    }
    char auth[300];
    snprintf(auth, sizeof(auth), "Bearer %s", token);
    esp_http_client_set_header(c, "Content-Type", "application/json");
    esp_http_client_set_header(c, "Authorization", auth);
    memset(auth, 0, sizeof(auth));

    if (esp_http_client_open(c, len) != ESP_OK) {
        esp_http_client_cleanup(c);
        return r;
    }
    int off = 0;
    while (off < len) {
        int w = esp_http_client_write(c, body + off, len - off);
        if (w <= 0) {
            esp_http_client_close(c);
            esp_http_client_cleanup(c);
            return r;
        }
        off += w;
        esp_task_wdt_reset();
    }
    if (esp_http_client_fetch_headers(c) < 0) {
        esp_http_client_close(c);
        esp_http_client_cleanup(c);
        return r;
    }
    r.status = esp_http_client_get_status_code(c);
    r.resp = malloc(RESP_CAP);
    if (r.resp) {
        int total = 0;
        for (;;) {
            int n = esp_http_client_read(c, r.resp + total, RESP_CAP - 1 - total);
            if (n <= 0) {
                break;
            }
            total += n;
            if (total >= RESP_CAP - 1) {
                break;
            }
        }
        r.resp[total] = '\0';
        r.resp_len = total;
    }
    esp_http_client_close(c);
    esp_http_client_cleanup(c);
    return r;
}

/* Returns true if the batch was (at least partly) acknowledged. */
static bool handle_ok(const char *resp, int n, int64_t rtt_ms)
{
    int64_t server_ms = -1;
    int nr = ldl_batch_parse_response(resp ? resp : "", &server_ms, s_results, LDL_MAX_BATCH);
    if (nr < 0) {
        set_result(200, "bad response JSON");
        app_set_error("uplink: unparsable response");
        return false;
    }
    if (server_ms > 0) {
        timesync_server_time(server_ms, rtt_ms);
    }
    int acked = 0, rejected = 0;
    uint32_t last_rid = 0;
    for (int i = 0; i < n; i++) {
        const ldl_result_t *hit = NULL;
        for (int k = 0; k < nr; k++) {
            if (strcmp(s_results[k].msg_id, s_ents[i].msg_id) == 0) {
                hit = &s_results[k];
                break;
            }
        }
        if (!hit || hit->status == LDL_RES_UNKNOWN) {
            break; /* keep this and later records for retry (order preserved) */
        }
        if (hit->status == LDL_RES_REJECTED) {
            rejected++;
            ESP_LOGW(TAG, "rejected %s: %s", hit->msg_id, hit->reason);
            app_set_error("rejected: %.70s", hit->reason);
        }
        last_rid = s_ents[i].rid;
        acked++;
    }
    if (acked > 0) {
        store_ack_through(last_rid);
    }
    APP_STATUS_UPDATE({
        st->msgs_acked += (uint32_t)acked;
        st->msgs_rejected += (uint32_t)rejected;
    });
    set_result(200, "200: %d/%d acked, %d rejected", acked, n, rejected);
    return acked > 0;
}

static void uplink_task(void *arg)
{
    esp_task_wdt_add(NULL);
    uint32_t attempt = 0;
    int max_batch = LDL_MAX_BATCH;
    char url[200];

    for (;;) {
        esp_task_wdt_reset();
        app_status_t st;
        app_status_get(&st);
        ldl_cfg_t cfg;
        cfg_get(&cfg);

        if (!st.has_ip || !cfg.url[0] || !cfg.token[0] || store_backlog() == 0) {
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000));
            continue;
        }
        size_t ul = strlen(cfg.url);
        while (ul && cfg.url[ul - 1] == '/') {
            cfg.url[--ul] = '\0';
        }
        snprintf(url, sizeof(url), "%s%s", cfg.url, INGEST_PATH);

        int len = 0;
        int n = store_build_batch(s_body, sizeof(s_body), &len, st.device_id, s_ents, max_batch);
        if (n == 0) {
            ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(1000));
            continue;
        }

        const int64_t t0 = esp_timer_get_time();
        http_result_t r = post(url, cfg.token, s_body, len);
        const int64_t rtt_ms = (esp_timer_get_time() - t0) / 1000;
        memset(cfg.token, 0, sizeof(cfg.token));
        esp_task_wdt_reset();

        uint32_t wait_ms = 0;
        bool ok = false;
        if (r.status == 200) {
            ok = handle_ok(r.resp, n, rtt_ms);
            if (ok) {
                attempt = 0;
                max_batch = LDL_MAX_BATCH;
                APP_STATUS_UPDATE({
                    st->uplink_ok = true;
                    st->ever_uploaded = true;
                    st->batches_ok++;
                });
                led_pulse_ok();
                ota_mark_valid_once();
            } else {
                wait_ms = ldl_backoff_ms(attempt++);
            }
        } else if (r.status == 401 || r.status == 403) {
            set_result(r.status, "%d: unauthorized, pausing 5 min", r.status);
            app_set_error("uplink: HTTP %d (check token)", r.status);
            wait_ms = AUTH_PAUSE_MS;
        } else if (r.status == 429 || r.status >= 500 || r.status < 0) {
            wait_ms = ldl_backoff_ms(attempt++);
            if (r.status < 0) {
                set_result(-1, "network error, retry in %us", (unsigned)(wait_ms / 1000));
                app_set_error("uplink: network error");
            } else {
                set_result(r.status, "%d, retry in %us", r.status, (unsigned)(wait_ms / 1000));
                app_set_error("uplink: HTTP %d", r.status);
            }
        } else {
            /* other 4xx: the batch itself is unacceptable. Narrow down to a
             * single record; if that alone is refused, discard it so one bad
             * record cannot block the queue forever. */
            if (max_batch > 1) {
                max_batch = 1;
                set_result(r.status, "%d, retrying one by one", r.status);
            } else {
                ESP_LOGE(TAG, "HTTP %d for single record %s: discarding", r.status, s_ents[0].msg_id);
                store_ack_through(s_ents[0].rid);
                APP_STATUS_UPDATE(st->msgs_rejected++);
                set_result(r.status, "%d, record discarded", r.status);
            }
            app_set_error("uplink: HTTP %d", r.status);
            wait_ms = ldl_backoff_ms(0);
        }
        free(r.resp);
        if (!ok) {
            APP_STATUS_UPDATE(st->uplink_ok = false);
        }
        if (wait_ms) {
            /* sleep in slices so the task watchdog stays fed */
            int64_t until = esp_timer_get_time() + (int64_t)wait_ms * 1000;
            while (esp_timer_get_time() < until) {
                vTaskDelay(pdMS_TO_TICKS(1000));
                esp_task_wdt_reset();
            }
        }
    }
}

TaskHandle_t uplink_start(void)
{
    TaskHandle_t h = NULL;
    xTaskCreatePinnedToCore(uplink_task, "uplink", 8192, NULL, 4, &h, 0);
    return h;
}
