#include "config.h"

#include <stddef.h>
#include <stdio.h>
#include <string.h>

#include "esp_console.h"
#include "esp_log.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/semphr.h"
#include "nvs.h"
#include "sdkconfig.h"

#include "app.h"
#include "ota.h"

static const char *TAG = "cfg";
#define NVS_NS "ldlcfg"

static ldl_cfg_t s_cfg;
static SemaphoreHandle_t s_lock;

typedef struct {
    const char *key;
    size_t off;
    size_t len;
    bool secret;
    bool needs_reboot;
} cfg_field_t;

#define FIELD(k, m, sec, rb) {k, offsetof(ldl_cfg_t, m), sizeof(((ldl_cfg_t *)0)->m), sec, rb}
static const cfg_field_t FIELDS[] = {
    FIELD("url", url, false, false),
    FIELD("token", token, true, false),
    FIELD("machine", machine, false, false),
    FIELD("ntp", ntp, false, true),
    FIELD("static_ip", static_ip, false, true),
    FIELD("gateway", gateway, false, true),
    FIELD("netmask", netmask, false, true),
    FIELD("dns", dns, false, true),
};
#define N_FIELDS (sizeof(FIELDS) / sizeof(FIELDS[0]))

static const cfg_field_t *find_field(const char *key)
{
    for (size_t i = 0; i < N_FIELDS; i++) {
        if (strcmp(FIELDS[i].key, key) == 0) {
            return &FIELDS[i];
        }
    }
    return NULL;
}

static void set_defaults(ldl_cfg_t *c)
{
    memset(c, 0, sizeof(*c));
    strlcpy(c->url, CONFIG_LDL_ENDPOINT_URL, sizeof(c->url));
    strlcpy(c->machine, CONFIG_LDL_MACHINE_ID, sizeof(c->machine));
    strlcpy(c->ntp, CONFIG_LDL_SNTP_SERVER, sizeof(c->ntp));
    strlcpy(c->netmask, "255.255.255.0", sizeof(c->netmask));
}

void cfg_load(void)
{
    if (!s_lock) {
        s_lock = xSemaphoreCreateMutex();
    }
    ldl_cfg_t c;
    set_defaults(&c);
    nvs_handle_t h;
    if (nvs_open(NVS_NS, NVS_READONLY, &h) == ESP_OK) {
        for (size_t i = 0; i < N_FIELDS; i++) {
            size_t len = FIELDS[i].len;
            char *dst = (char *)&c + FIELDS[i].off;
            char tmp[256];
            size_t tlen = sizeof(tmp);
            if (nvs_get_str(h, FIELDS[i].key, tmp, &tlen) == ESP_OK && tmp[0]) {
                strlcpy(dst, tmp, len);
            }
        }
        nvs_close(h);
    }
    xSemaphoreTake(s_lock, portMAX_DELAY);
    s_cfg = c;
    xSemaphoreGive(s_lock);
}

void cfg_get(ldl_cfg_t *out)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    *out = s_cfg;
    xSemaphoreGive(s_lock);
}

void cfg_get_machine(char *out, size_t len)
{
    xSemaphoreTake(s_lock, portMAX_DELAY);
    strlcpy(out, s_cfg.machine, len);
    xSemaphoreGive(s_lock);
}

esp_err_t cfg_set(const char *key, const char *value)
{
    const cfg_field_t *f = find_field(key);
    if (!f) {
        return ESP_ERR_NOT_FOUND;
    }
    if (strlen(value) >= f->len) {
        return ESP_ERR_INVALID_SIZE;
    }
    nvs_handle_t h;
    esp_err_t err = nvs_open(NVS_NS, NVS_READWRITE, &h);
    if (err != ESP_OK) {
        return err;
    }
    if (value[0]) {
        err = nvs_set_str(h, key, value);
    } else {
        err = nvs_erase_key(h, key);
        if (err == ESP_ERR_NVS_NOT_FOUND) {
            err = ESP_OK;
        }
    }
    if (err == ESP_OK) {
        err = nvs_commit(h);
    }
    nvs_close(h);
    if (err == ESP_OK) {
        cfg_load(); /* re-apply defaults for cleared keys */
    }
    return err;
}

uint32_t cfg_next_boot_id(void)
{
    nvs_handle_t h;
    uint32_t id = 0;
    if (nvs_open("ldl", NVS_READWRITE, &h) != ESP_OK) {
        return 0;
    }
    nvs_get_u32(h, "boot_id", &id);
    id++;
    nvs_set_u32(h, "boot_id", id);
    nvs_commit(h);
    nvs_close(h);
    return id;
}

/* ---------------- console ---------------- */

static void print_value(const cfg_field_t *f, const ldl_cfg_t *c)
{
    const char *v = (const char *)c + f->off;
    if (f->secret) {
        size_t n = strlen(v);
        if (n == 0) {
            printf("%-10s (not set)\n", f->key);
        } else if (n <= 8) {
            printf("%-10s **** (%u chars)\n", f->key, (unsigned)n);
        } else {
            printf("%-10s %.4s****%s (%u chars)\n", f->key, v, v + n - 2, (unsigned)n);
        }
    } else {
        printf("%-10s %s\n", f->key, v[0] ? v : "(not set)");
    }
}

static int cmd_set(int argc, char **argv)
{
    if (argc < 2 || argc > 3) {
        printf("usage: set <key> [value]   (no value clears the key)\n");
        return 1;
    }
    const cfg_field_t *f = find_field(argv[1]);
    if (!f) {
        printf("unknown key '%s'\n", argv[1]);
        return 1;
    }
    esp_err_t err = cfg_set(argv[1], argc == 3 ? argv[2] : "");
    if (err != ESP_OK) {
        printf("error: %s\n", esp_err_to_name(err));
        return 1;
    }
    printf("ok%s\n", f->needs_reboot ? " (reboot to apply)" : "");
    return 0;
}

static int cmd_get(int argc, char **argv)
{
    if (argc != 2) {
        printf("usage: get <key>\n");
        return 1;
    }
    const cfg_field_t *f = find_field(argv[1]);
    if (!f) {
        printf("unknown key '%s'\n", argv[1]);
        return 1;
    }
    ldl_cfg_t c;
    cfg_get(&c);
    print_value(f, &c);
    return 0;
}

static int cmd_show(int argc, char **argv)
{
    ldl_cfg_t c;
    cfg_get(&c);
    for (size_t i = 0; i < N_FIELDS; i++) {
        print_value(&FIELDS[i], &c);
    }
    app_status_t s;
    app_status_get(&s);
    printf("deviceId   %s\nbootId     %u\nhostname   %s\nip         %s%s\nlink       %s\n", s.device_id,
           (unsigned)s.boot_id, s.hostname, s.has_ip ? s.ip : "-", s.static_ip_used ? " (static)" : "",
           s.link_up ? "up" : "down");
    printf("picks      %llu\nbacklog    %u (dropped %u)\nuplink     %s\n", (unsigned long long)s.picks_total,
           (unsigned)s.backlog, (unsigned)s.dropped, s.last_uplink[0] ? s.last_uplink : "-");
    return 0;
}

static int cmd_reboot(int argc, char **argv)
{
    printf("rebooting...\n");
    fflush(stdout);
    vTaskDelay(pdMS_TO_TICKS(100));
    esp_restart();
    return 0;
}

static int cmd_ota(int argc, char **argv)
{
    if (argc != 2) {
        printf("usage: ota <https-url-of-firmware.bin>\n");
        return 1;
    }
    esp_err_t err = ota_start(argv[1]);
    printf("ota: %s\n", esp_err_to_name(err));
    return err == ESP_OK ? 0 : 1;
}

void cfg_console_start(void)
{
    esp_console_repl_t *repl = NULL;
    esp_console_repl_config_t rc = ESP_CONSOLE_REPL_CONFIG_DEFAULT();
    rc.prompt = "ldl>";
    rc.max_cmdline_length = 512;
    esp_console_dev_uart_config_t uc = ESP_CONSOLE_DEV_UART_CONFIG_DEFAULT();
    if (esp_console_new_repl_uart(&uc, &rc, &repl) != ESP_OK) {
        ESP_LOGE(TAG, "console init failed");
        return;
    }
    const esp_console_cmd_t cmds[] = {
        {.command = "set", .help = "set <key> [value]  keys: url token machine ntp static_ip gateway netmask dns",
         .func = cmd_set},
        {.command = "get", .help = "get <key>", .func = cmd_get},
        {.command = "show", .help = "show config (token masked) and status", .func = cmd_show},
        {.command = "reboot", .help = "restart the device", .func = cmd_reboot},
        {.command = "ota", .help = "ota <url>  download and boot a new image (rollback protected)",
         .func = cmd_ota},
    };
    for (size_t i = 0; i < sizeof(cmds) / sizeof(cmds[0]); i++) {
        esp_console_cmd_register(&cmds[i]);
    }
    esp_console_register_help_command();
    esp_console_start_repl(repl);
}
