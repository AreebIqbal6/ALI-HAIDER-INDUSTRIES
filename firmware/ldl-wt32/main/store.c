#include "store.h"

#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "esp_log.h"
#include "esp_partition.h"
#include "esp_task_wdt.h"
#include "esp_timer.h"
#include "freertos/queue.h"
#include "freertos/semphr.h"
#include "sdkconfig.h"

#include "app.h"
#include "ldl_contract.h"
#include "ldl_outbox.h"

static const char *TAG = "store";

#define PART_SUBTYPE_JOURNAL 0x40
#define PART_SUBTYPE_OUTBOX 0x41
#define QUEUE_LEN 32
#define JOURNAL_IDLE_MS 60000

static ldl_flash_t s_jflash, s_oflash;
static ldl_journal_t s_journal;
static ldl_outbox_t s_outbox;
static SemaphoreHandle_t s_lock;
static QueueHandle_t s_queue;
static TaskHandle_t s_uplink;
static uint32_t s_boot_id;
static bool s_ready;
static uint32_t s_queue_drops;

static portMUX_TYPE s_snap_mux = portMUX_INITIALIZER_UNLOCKED;
static struct {
    uint64_t picks;
    uint64_t run_ms;
    uint64_t stop_ms;
} s_snap;

/* ---- ldl_flash_t over esp_partition ---- */

static int p_read(void *ctx, uint32_t off, void *buf, size_t len)
{
    return esp_partition_read((const esp_partition_t *)ctx, off, buf, len) == ESP_OK ? 0 : -1;
}

static int p_write(void *ctx, uint32_t off, const void *buf, size_t len)
{
    return esp_partition_write((const esp_partition_t *)ctx, off, buf, len) == ESP_OK ? 0 : -1;
}

static int p_erase(void *ctx, uint32_t off, size_t len)
{
    return esp_partition_erase_range((const esp_partition_t *)ctx, off, len) == ESP_OK ? 0 : -1;
}

static bool bind(ldl_flash_t *f, uint8_t subtype, const char *label)
{
    const esp_partition_t *p =
        esp_partition_find_first(ESP_PARTITION_TYPE_DATA, (esp_partition_subtype_t)subtype, label);
    if (!p) {
        ESP_LOGE(TAG, "partition '%s' missing", label);
        return false;
    }
    f->ctx = (void *)p;
    f->size = p->size;
    f->sector_size = p->erase_size ? p->erase_size : 4096;
    f->read = p_read;
    f->write = p_write;
    f->erase = p_erase;
    return true;
}

static void publish_status(void)
{
    const uint32_t backlog = s_outbox.count, dropped = s_outbox.dropped + s_queue_drops;
    const uint32_t jerr = s_journal.write_errors;
    APP_STATUS_UPDATE({
        st->backlog = backlog;
        st->dropped = dropped;
        st->journal_errors = jerr;
    });
}

esp_err_t store_init(uint32_t boot_id, ldl_journal_rec_t *last, bool *have_last)
{
    s_boot_id = boot_id;
    s_lock = xSemaphoreCreateMutex();
    s_queue = xQueueCreate(QUEUE_LEN, sizeof(char *));
    *have_last = false;
    if (!s_lock || !s_queue) {
        return ESP_ERR_NO_MEM;
    }
    if (!bind(&s_jflash, PART_SUBTYPE_JOURNAL, "journal") || !bind(&s_oflash, PART_SUBTYPE_OUTBOX, "outbox")) {
        return ESP_ERR_NOT_FOUND;
    }
    const int64_t t0 = esp_timer_get_time();
    *have_last = ldl_journal_open(&s_journal, &s_jflash);
    if (*have_last) {
        *last = s_journal.last;
        ESP_LOGI(TAG, "journal: restored picks=%llu (boot %u, seq %u)",
                 (unsigned long long)last->picks_total, (unsigned)last->boot_id, (unsigned)last->seq);
    } else {
        ESP_LOGW(TAG, "journal: no valid record, counters start at 0");
    }
    uint32_t pending = ldl_outbox_open(&s_outbox, &s_oflash);
    ESP_LOGI(TAG, "outbox: %u pending, next rid %u, corrupt %u (scan %lld ms)", (unsigned)pending,
             (unsigned)s_outbox.next_rid, (unsigned)s_outbox.corrupt, (esp_timer_get_time() - t0) / 1000);
    s_ready = true;
    publish_status();
    return ESP_OK;
}

bool store_enqueue(char *json)
{
    if (!json) {
        return false;
    }
    if (!s_queue || xQueueSend(s_queue, &json, 0) != pdTRUE) {
        s_queue_drops++;
        ESP_LOGE(TAG, "queue full, message dropped");
        cJSON_free(json);
        return false;
    }
    return true;
}

void store_journal_snapshot(uint64_t picks_total, uint64_t run_ms, uint64_t stop_ms)
{
    taskENTER_CRITICAL(&s_snap_mux);
    s_snap.picks = picks_total;
    s_snap.run_ms = run_ms;
    s_snap.stop_ms = stop_ms;
    taskEXIT_CRITICAL(&s_snap_mux);
}

uint32_t store_backlog(void)
{
    return s_outbox.count;
}

static void write_one(char *json)
{
    size_t len = strlen(json);
    if (len > LDL_OUTBOX_MAX_PAYLOAD) {
        ESP_LOGE(TAG, "envelope too large (%u)", (unsigned)len);
        app_set_error("envelope too large");
    } else {
        xSemaphoreTake(s_lock, portMAX_DELAY);
        int rc = ldl_outbox_append(&s_outbox, s_boot_id, json, (uint16_t)len);
        xSemaphoreGive(s_lock);
        if (rc != 0) {
            app_set_error("outbox write failed (%d)", rc);
        }
    }
    cJSON_free(json);
}

static void store_task(void *arg)
{
    esp_task_wdt_add(NULL);
    uint64_t last_picks = UINT64_MAX;
    int64_t last_journal_us = 0;
    const int64_t interval_us = (int64_t)CONFIG_LDL_JOURNAL_INTERVAL_MS * 1000;

    for (;;) {
        char *json = NULL;
        if (xQueueReceive(s_queue, &json, pdMS_TO_TICKS(100)) == pdTRUE) {
            write_one(json);
            /* drain whatever else is queued */
            while (xQueueReceive(s_queue, &json, 0) == pdTRUE) {
                write_one(json);
            }
            publish_status();
            if (s_uplink) {
                xTaskNotifyGive(s_uplink);
            }
        }

        const int64_t now = esp_timer_get_time();
        if (now - last_journal_us >= interval_us) {
            taskENTER_CRITICAL(&s_snap_mux);
            const uint64_t picks = s_snap.picks, run = s_snap.run_ms, stop = s_snap.stop_ms;
            taskEXIT_CRITICAL(&s_snap_mux);
            if (picks != last_picks || now - last_journal_us >= (int64_t)JOURNAL_IDLE_MS * 1000) {
                if (ldl_journal_append(&s_journal, s_boot_id, picks, (uint32_t)run, (uint32_t)stop) != 0) {
                    app_set_error("journal write failed");
                }
                last_picks = picks;
                last_journal_us = now;
                publish_status();
            }
        }
        esp_task_wdt_reset();
    }
}

void store_start(TaskHandle_t uplink)
{
    s_uplink = uplink;
    xTaskCreatePinnedToCore(store_task, "store", 4096, NULL, 6, NULL, 0);
}

int store_build_batch(char *buf, int cap, int *len, const char *device_id, store_batch_entry_t *ents, int max)
{
    *len = 0;
    if (!s_ready) {
        return 0;
    }
    char *tmp = malloc(LDL_OUTBOX_MAX_PAYLOAD + 1);
    if (!tmp) {
        return 0;
    }
    int used = ldl_batch_begin(buf, cap, device_id);
    int n = 0;
    xSemaphoreTake(s_lock, portMAX_DELAY);
    ldl_outbox_item_t it, nx;
    bool have = ldl_outbox_first(&s_outbox, &it);
    while (have && n < max && used > 0) {
        int rl = ldl_outbox_read(&s_outbox, &it, tmp, LDL_OUTBOX_MAX_PAYLOAD + 1);
        if (rl > 0 && ldl_contract_msg_id(tmp, ents[n].msg_id)) {
            int u2 = ldl_batch_add(buf, cap, used, n, tmp, it.boot_id != s_boot_id);
            if (u2 < 0) {
                break; /* body full: send what we have */
            }
            used = u2;
            ents[n].rid = it.rid;
            n++;
        } else if (n == 0) {
            /* unreadable record at the head: drop it so delivery can continue */
            ESP_LOGE(TAG, "dropping unreadable record rid %u", (unsigned)it.rid);
            ldl_outbox_ack_through(&s_outbox, it.rid);
            have = ldl_outbox_first(&s_outbox, &it);
            continue;
        } else {
            break;
        }
        have = ldl_outbox_next(&s_outbox, &it, &nx);
        it = nx;
    }
    xSemaphoreGive(s_lock);
    free(tmp);
    if (n == 0 || used < 0) {
        return 0;
    }
    used = ldl_batch_end(buf, cap, used);
    if (used < 0) {
        return 0;
    }
    *len = used;
    return n;
}

void store_ack_through(uint32_t rid)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    ldl_outbox_ack_through(&s_outbox, rid);
    xSemaphoreGive(s_lock);
    publish_status();
}
