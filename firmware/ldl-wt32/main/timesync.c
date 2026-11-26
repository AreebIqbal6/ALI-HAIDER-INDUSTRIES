#include "timesync.h"

#include <string.h>
#include <sys/time.h>

#include "esp_log.h"
#include "esp_netif_sntp.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"

static const char *TAG = "time";
static volatile bool s_synced;
static int64_t s_offset_ms;   /* wall = mono_ms + offset (from serverTime) */
static bool s_have_offset;
static portMUX_TYPE s_mux = portMUX_INITIALIZER_UNLOCKED;
static char s_server[64];

static void on_sync(struct timeval *tv)
{
    if (!s_synced) {
        ESP_LOGI(TAG, "SNTP synchronised");
    }
    s_synced = true;
}

void timesync_init(const char *server)
{
    strlcpy(s_server, server && server[0] ? server : "pool.ntp.org", sizeof(s_server));
    esp_sntp_config_t cfg = ESP_NETIF_SNTP_DEFAULT_CONFIG(s_server);
    cfg.sync_cb = on_sync;
    cfg.start = true;
    esp_err_t err = esp_netif_sntp_init(&cfg);
    if (err != ESP_OK) {
        ESP_LOGE(TAG, "sntp init: %s", esp_err_to_name(err));
    }
}

bool timesync_synced(void)
{
    return s_synced;
}

int64_t timesync_now_ms(bool *synced)
{
    if (s_synced) {
        struct timeval tv;
        gettimeofday(&tv, NULL);
        if (synced) {
            *synced = true;
        }
        return (int64_t)tv.tv_sec * 1000 + tv.tv_usec / 1000;
    }
    if (synced) {
        *synced = false;
    }
    const int64_t mono_ms = esp_timer_get_time() / 1000;
    int64_t off = 0;
    taskENTER_CRITICAL(&s_mux);
    if (s_have_offset) {
        off = s_offset_ms;
    }
    taskEXIT_CRITICAL(&s_mux);
    return mono_ms + off;
}

void timesync_server_time(int64_t server_ms, int64_t rtt_ms)
{
    if (server_ms <= 0) {
        return;
    }
    const int64_t mono_ms = esp_timer_get_time() / 1000;
    const int64_t off = server_ms + rtt_ms / 2 - mono_ms;
    taskENTER_CRITICAL(&s_mux);
    s_offset_ms = off;
    s_have_offset = true;
    taskEXIT_CRITICAL(&s_mux);
}
