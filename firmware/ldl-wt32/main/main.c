/*
 * main.c - LDL firmware entry: bring-up order and the health reporter.
 */
#include <stdio.h>
#include <string.h>

#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "esp_timer.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "nvs_flash.h"
#include "sdkconfig.h"

#include "app.h"
#include "config.h"
#include "inputs.h"
#include "led.h"
#include "net.h"
#include "statuspage.h"
#include "store.h"
#include "timesync.h"
#include "uplink.h"

static const char *TAG = "main";

static void publish_health(void)
{
    app_status_t s;
    app_status_get(&s);
    ldl_msg_t m = {.type = LDL_MSG_HEALTH};
    ldl_health_t *h = &m.u.health;
    h->status = "ONLINE";
    h->ip_address = s.has_ip ? s.ip : NULL;
    h->firmware_version = CONFIG_LDL_FIRMWARE_VERSION;
    h->uptime_s = (uint32_t)(esp_timer_get_time() / 1000000);
    h->last_error = s.last_error[0] ? s.last_error : NULL;
    h->boot_id = s.boot_id;
    h->buffer_type = "flash";
    h->buffer_backlog = s.backlog;
    h->clock_synced = timesync_synced();
    h->link_up = s.link_up;
    app_publish(&m);
}

void app_main(void)
{
    esp_err_t err = nvs_flash_init();
    if (err == ESP_ERR_NVS_NO_FREE_PAGES || err == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        err = nvs_flash_init();
    }
    ESP_ERROR_CHECK(err);
    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());

    cfg_load();
    ldl_cfg_t cfg;
    cfg_get(&cfg);

    const uint32_t boot_id = cfg_next_boot_id();
    char device_id[13];
    net_device_id(device_id);
    char hostname[24];
    snprintf(hostname, sizeof(hostname), "ldl-%s", device_id);
    APP_STATUS_UPDATE({
        strlcpy(st->device_id, device_id, sizeof(st->device_id));
        strlcpy(st->hostname, hostname, sizeof(st->hostname));
        st->boot_id = boot_id;
    });
    ESP_LOGI(TAG, "%s deviceId=%s bootId=%u machine=%s", CONFIG_LDL_FIRMWARE_VERSION, device_id,
             (unsigned)boot_id, cfg.machine);

    led_start();

    ldl_journal_rec_t last = {0};
    bool restored = false;
    if (store_init(boot_id, &last, &restored) != ESP_OK) {
        app_set_error("storage init failed");
    }
    ESP_ERROR_CHECK(inputs_init(restored ? last.picks_total : 0));

    const ldl_cls_config_t cls_cfg = {
        .pre_ms = CONFIG_LDL_CLASSIFY_PRE_MS,
        .post_ms = CONFIG_LDL_CLASSIFY_POST_MS,
        .failed_start_picks = CONFIG_LDL_FAILED_START_PICKS,
        .state_interval_ms = CONFIG_LDL_STATE_INTERVAL_S * 1000,
        .window_ms = 60000,
        .rpm_timeout_ms = 2000,
    };

    TaskHandle_t up = uplink_start();
    store_start(up);
    loom_start(&cls_cfg, restored ? last.picks_total : 0, restored ? last.run_ms : 0,
               restored ? last.stop_ms : 0, !restored);

    if (net_init(hostname) != ESP_OK) {
        app_set_error("ethernet init failed");
    }
    timesync_init(cfg.ntp);
    memset(cfg.token, 0, sizeof(cfg.token));
#if CONFIG_LDL_STATUS_PAGE
    statuspage_start();
#endif
    cfg_console_start();

    /* health: once shortly after boot, then every interval */
    vTaskDelay(pdMS_TO_TICKS(10000));
    for (;;) {
        publish_health();
        vTaskDelay(pdMS_TO_TICKS(CONFIG_LDL_HEALTH_INTERVAL_S * 1000));
    }
}
