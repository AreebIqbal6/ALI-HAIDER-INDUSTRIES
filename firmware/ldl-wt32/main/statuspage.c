#include "statuspage.h"

#include <stdio.h>
#include <string.h>

#include "cJSON.h"
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_timer.h"
#include "sdkconfig.h"

#include "app.h"
#include "config.h"
#include "inputs.h"
#include "timesync.h"

static const char *TAG = "status";

static const char *const IN_NAMES[APP_INPUTS] = {"STRT", "PP", "WD", "FD", "LD", "RES"};

static const char *phase_name(ldl_phase_t p)
{
    switch (p) {
    case LDL_PHASE_RUNNING:
        return "RUNNING";
    case LDL_PHASE_CLASSIFYING:
        return "STOPPING";
    default:
        return "STOPPED";
    }
}

static cJSON *build_status(void)
{
    app_status_t s;
    app_status_get(&s);
    ldl_cfg_t cfg;
    cfg_get(&cfg);
    bool synced = false;
    char now[LDL_ISO_LEN];
    ldl_iso_format(timesync_now_ms(&synced), now);

    cJSON *j = cJSON_CreateObject();
    cJSON_AddStringToObject(j, "deviceId", s.device_id);
    cJSON_AddStringToObject(j, "machineId", cfg.machine);
    cJSON_AddStringToObject(j, "firmwareVersion", CONFIG_LDL_FIRMWARE_VERSION);
    cJSON_AddNumberToObject(j, "bootId", s.boot_id);
    cJSON_AddNumberToObject(j, "uptimeSeconds", (double)(esp_timer_get_time() / 1000000));
    cJSON_AddStringToObject(j, "time", now);
    cJSON_AddBoolToObject(j, "clockSynced", synced);
    cJSON_AddBoolToObject(j, "linkUp", s.link_up);
    cJSON_AddStringToObject(j, "ipAddress", s.has_ip ? s.ip : "");
    cJSON_AddBoolToObject(j, "staticIp", s.static_ip_used);
    cJSON *in = cJSON_AddObjectToObject(j, "inputsActive");
    for (int i = 0; i < APP_INPUTS; i++) {
        cJSON_AddBoolToObject(in, IN_NAMES[i], s.raw_active[i]);
    }
    cJSON_AddStringToObject(j, "state", phase_name(s.phase));
    const char *cat = ldl_cat_name(s.cat);
    if (cat && s.phase != LDL_PHASE_RUNNING) {
        cJSON_AddStringToObject(j, "stopCategory", cat);
    } else {
        cJSON_AddNullToObject(j, "stopCategory");
    }
    cJSON_AddNumberToObject(j, "rpm", ldl_round1(s.rpm));
    cJSON_AddNumberToObject(j, "picksTotal", (double)s.picks_total);
    cJSON_AddNumberToObject(j, "bufferBacklog", s.backlog);
    cJSON_AddNumberToObject(j, "bufferDropped", s.dropped);
    cJSON_AddNumberToObject(j, "inputOverruns", inputs_overruns());
    cJSON_AddBoolToObject(j, "endpointConfigured", cfg.url[0] != 0);
    cJSON_AddBoolToObject(j, "tokenConfigured", cfg.token[0] != 0);
    cJSON_AddBoolToObject(j, "uplinkOk", s.uplink_ok);
    cJSON_AddNumberToObject(j, "lastHttpStatus", s.last_http_status);
    cJSON_AddStringToObject(j, "lastUplink", s.last_uplink);
    cJSON_AddNumberToObject(j, "batchesOk", s.batches_ok);
    cJSON_AddNumberToObject(j, "msgsAcked", s.msgs_acked);
    cJSON_AddNumberToObject(j, "msgsRejected", s.msgs_rejected);
    cJSON_AddStringToObject(j, "lastError", s.last_error);
    memset(cfg.token, 0, sizeof(cfg.token));
    return j;
}

static esp_err_t get_json(httpd_req_t *req)
{
    cJSON *j = build_status();
    char *txt = cJSON_PrintUnformatted(j);
    cJSON_Delete(j);
    if (!txt) {
        return httpd_resp_send_500(req);
    }
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    httpd_resp_sendstr(req, txt);
    cJSON_free(txt);
    return ESP_OK;
}

/* Small static page that polls /status.json; no secrets are ever rendered. */
static const char PAGE[] =
    "<!doctype html><html><head><meta charset=utf-8>"
    "<meta name=viewport content='width=device-width,initial-scale=1'>"
    "<title>LDL status</title><style>"
    "body{font:15px system-ui,sans-serif;margin:16px;background:#f6f7f9;color:#111}"
    "h1{font-size:18px}table{border-collapse:collapse;background:#fff}"
    "td{padding:4px 10px;border-bottom:1px solid #ddd}td:first-child{color:#555}"
    ".on{color:#fff;background:#c62828;padding:1px 6px;border-radius:3px}"
    ".off{color:#555;background:#e0e0e0;padding:1px 6px;border-radius:3px}"
    "</style></head><body><h1>Loom Data Logger</h1><div id=in></div><br><table id=t></table>"
    "<script>"
    "const K=['deviceId','machineId','state','stopCategory','rpm','picksTotal','bufferBacklog',"
    "'bufferDropped','lastUplink','lastHttpStatus','uplinkOk','batchesOk','msgsAcked','msgsRejected',"
    "'linkUp','ipAddress','clockSynced','time','uptimeSeconds','bootId','firmwareVersion','lastError',"
    "'endpointConfigured','tokenConfigured','inputOverruns'];"
    "function e(s){return String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]))}"
    "async function u(){try{const r=await fetch('/status.json');const j=await r.json();"
    "document.getElementById('in').innerHTML=Object.entries(j.inputsActive).map(([k,v])=>"
    "`<span class=${v?'on':'off'}>${k}</span>`).join(' ');"
    "document.getElementById('t').innerHTML=K.map(k=>`<tr><td>${k}</td><td>${e(j[k])}</td></tr>`).join('');"
    "}catch(x){}}u();setInterval(u,1000);"
    "</script></body></html>";

static esp_err_t get_root(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html");
    return httpd_resp_send(req, PAGE, sizeof(PAGE) - 1);
}

void statuspage_start(void)
{
    httpd_config_t cfg = HTTPD_DEFAULT_CONFIG();
    cfg.server_port = 80;
    cfg.stack_size = 6144;
    cfg.max_uri_handlers = 4;
    httpd_handle_t h = NULL;
    if (httpd_start(&h, &cfg) != ESP_OK) {
        ESP_LOGE(TAG, "httpd start failed");
        return;
    }
    const httpd_uri_t root = {.uri = "/", .method = HTTP_GET, .handler = get_root};
    const httpd_uri_t json = {.uri = "/status.json", .method = HTTP_GET, .handler = get_json};
    httpd_register_uri_handler(h, &root);
    httpd_register_uri_handler(h, &json);
    ESP_LOGI(TAG, "status page on port 80");
}
