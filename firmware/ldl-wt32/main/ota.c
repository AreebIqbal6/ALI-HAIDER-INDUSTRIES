#include "ota.h"

#include <stdlib.h>
#include <string.h>

#include "esp_crt_bundle.h"
#include "esp_http_client.h"
#include "esp_https_ota.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "ota";
static bool s_marked;
static volatile bool s_running;

void ota_mark_valid_once(void)
{
    if (s_marked) {
        return;
    }
    s_marked = true;
    const esp_partition_t *running = esp_ota_get_running_partition();
    esp_ota_img_states_t state;
    if (esp_ota_get_state_partition(running, &state) == ESP_OK && state == ESP_OTA_IMG_PENDING_VERIFY) {
        ESP_LOGI(TAG, "first successful upload: marking image valid");
        esp_ota_mark_app_valid_cancel_rollback();
    }
}

static void ota_task(void *arg)
{
    char *url = arg;
    esp_http_client_config_t http = {
        .url = url,
        .crt_bundle_attach = esp_crt_bundle_attach,
        .timeout_ms = 15000,
        .keep_alive_enable = true,
    };
    esp_https_ota_config_t cfg = {.http_config = &http};
    ESP_LOGI(TAG, "starting OTA");
    esp_err_t err = esp_https_ota(&cfg);
    free(url);
    if (err == ESP_OK) {
        ESP_LOGI(TAG, "OTA done, rebooting");
        vTaskDelay(pdMS_TO_TICKS(500));
        esp_restart();
    }
    ESP_LOGE(TAG, "OTA failed: %s", esp_err_to_name(err));
    s_running = false;
    vTaskDelete(NULL);
}

esp_err_t ota_start(const char *url)
{
    if (s_running) {
        return ESP_ERR_INVALID_STATE;
    }
    if (strncmp(url, "https://", 8) != 0) {
        return ESP_ERR_INVALID_ARG;
    }
    char *copy = strdup(url);
    if (!copy) {
        return ESP_ERR_NO_MEM;
    }
    s_running = true;
    if (xTaskCreate(ota_task, "ota", 8192, copy, 4, NULL) != pdPASS) {
        free(copy);
        s_running = false;
        return ESP_ERR_NO_MEM;
    }
    return ESP_OK;
}
