#include "ldl_contract.h"

#include <math.h>
#include <stdio.h>
#include <string.h>

#include "cJSON.h"

static const char *const CAT_NAMES[LDL_CAT_COUNT] = {"WARP", "FILLING", "SELVEDGE", "OTHER"};

const char *ldl_cat_name(ldl_stop_cat_t c)
{
    if (c < 0 || c >= LDL_CAT_COUNT) {
        return NULL;
    }
    return CAT_NAMES[c];
}

double ldl_round1(double v)
{
    return round(v * 10.0) / 10.0;
}

static void add_ts(cJSON *o, const char *key, int64_t ms)
{
    char iso[LDL_ISO_LEN];
    ldl_iso_format(ms, iso);
    cJSON_AddStringToObject(o, key, iso);
}

static void add_cat(cJSON *o, const char *key, ldl_stop_cat_t c)
{
    const char *n = ldl_cat_name(c);
    if (n) {
        cJSON_AddStringToObject(o, key, n);
    } else {
        cJSON_AddNullToObject(o, key);
    }
}

static void add_str_or_null(cJSON *o, const char *key, const char *v)
{
    if (v && v[0]) {
        cJSON_AddStringToObject(o, key, v);
    } else {
        cJSON_AddNullToObject(o, key);
    }
}

static void add_u64(cJSON *o, const char *key, uint64_t v)
{
    cJSON_AddNumberToObject(o, key, (double)v);
}

static cJSON *encode_data(const ldl_msg_t *m, const char **schema)
{
    cJSON *d = cJSON_CreateObject();
    if (!d) {
        return NULL;
    }
    switch (m->type) {
    case LDL_MSG_STATE: {
        const ldl_state_data_t *s = &m->u.state;
        *schema = LDL_SCHEMA_STATE;
        cJSON_AddStringToObject(d, "state", s->running ? "RUNNING" : "STOPPED");
        add_cat(d, "stopCategory", s->running ? LDL_CAT_NONE : s->cat);
        add_str_or_null(d, "stopId", s->running ? NULL : s->stop_id);
        add_ts(d, "since", s->since_ms);
        cJSON_AddNumberToObject(d, "rpm", ldl_round1(s->rpm));
        add_u64(d, "picksTotal", s->picks_total);
        break;
    }
    case LDL_MSG_STOP_STARTED: {
        const ldl_stop_started_t *e = &m->u.stop_started;
        *schema = LDL_SCHEMA_EVENT;
        cJSON_AddStringToObject(d, "eventType", "STOP_STARTED");
        cJSON_AddStringToObject(d, "stopId", e->stop_id);
        add_cat(d, "stopCategory", e->cat);
        add_ts(d, "detectedAt", e->detected_ms);
        add_u64(d, "picksTotal", e->picks_total);
        break;
    }
    case LDL_MSG_STOP_ENDED: {
        const ldl_stop_ended_t *e = &m->u.stop_ended;
        *schema = LDL_SCHEMA_EVENT;
        cJSON_AddStringToObject(d, "eventType", "STOP_ENDED");
        cJSON_AddStringToObject(d, "stopId", e->stop_id);
        add_cat(d, "stopCategory", e->cat);
        cJSON_AddNumberToObject(d, "durationMs", (double)e->duration_ms);
        cJSON_AddNumberToObject(d, "failedStartAttempts", e->failed_attempts);
        add_u64(d, "picksTotal", e->picks_total);
        break;
    }
    case LDL_MSG_START_FAILED: {
        const ldl_start_failed_t *e = &m->u.start_failed;
        *schema = LDL_SCHEMA_EVENT;
        cJSON_AddStringToObject(d, "eventType", "START_ATTEMPT_FAILED");
        cJSON_AddStringToObject(d, "stopId", e->stop_id);
        add_cat(d, "stopCategory", e->cat);
        add_ts(d, "detectedAt", e->detected_ms);
        cJSON_AddNumberToObject(d, "attempt", e->attempt);
        cJSON_AddNumberToObject(d, "picksInAttempt", e->picks_in_attempt);
        add_u64(d, "picksTotal", e->picks_total);
        break;
    }
    case LDL_MSG_DISCONTINUITY: {
        const ldl_discontinuity_t *e = &m->u.discontinuity;
        *schema = LDL_SCHEMA_EVENT;
        cJSON_AddStringToObject(d, "eventType", "COUNTER_DISCONTINUITY");
        add_ts(d, "detectedAt", e->detected_ms);
        cJSON_AddStringToObject(d, "reason", e->reason ? e->reason : "COUNTERS_LOST");
        add_u64(d, "picksTotal", e->picks_total);
        break;
    }
    case LDL_MSG_COUNTERS: {
        const ldl_counters_t *c = &m->u.counters;
        *schema = LDL_SCHEMA_COUNTERS;
        add_ts(d, "windowStart", c->window_start_ms);
        add_ts(d, "windowEnd", c->window_end_ms);
        add_u64(d, "picksDelta", c->picks_delta);
        add_u64(d, "picksTotal", c->picks_total);
        cJSON_AddNumberToObject(d, "runMs", c->run_ms);
        cJSON_AddNumberToObject(d, "stopMs", c->stop_ms);
        cJSON_AddNumberToObject(d, "offlineMs", c->offline_ms);
        cJSON *stops = cJSON_AddObjectToObject(d, "stops");
        for (int i = 0; i < LDL_CAT_COUNT && stops; i++) {
            cJSON_AddNumberToObject(stops, CAT_NAMES[i], c->stops[i]);
        }
        cJSON_AddNumberToObject(d, "rpmAvgRunning", ldl_round1(c->rpm_avg_running));
        break;
    }
    case LDL_MSG_HEALTH: {
        const ldl_health_t *h = &m->u.health;
        *schema = LDL_SCHEMA_HEALTH;
        cJSON_AddStringToObject(d, "status", h->status ? h->status : "ONLINE");
        add_str_or_null(d, "ipAddress", h->ip_address);
        cJSON_AddStringToObject(d, "firmwareVersion", h->firmware_version ? h->firmware_version : "");
        cJSON_AddNumberToObject(d, "uptimeSeconds", h->uptime_s);
        add_str_or_null(d, "lastError", h->last_error);
        cJSON_AddNumberToObject(d, "bootId", h->boot_id);
        cJSON_AddStringToObject(d, "bufferType", h->buffer_type ? h->buffer_type : "flash");
        cJSON_AddNumberToObject(d, "bufferBacklog", h->buffer_backlog);
        cJSON_AddBoolToObject(d, "clockSynced", h->clock_synced);
        cJSON_AddBoolToObject(d, "linkUp", h->link_up);
        break;
    }
    default:
        cJSON_Delete(d);
        return NULL;
    }
    return d;
}

char *ldl_contract_encode(const ldl_identity_t *id, const ldl_meta_t *meta, const ldl_msg_t *msg)
{
    const char *schema = NULL;
    cJSON *data = encode_data(msg, &schema);
    if (!data) {
        return NULL;
    }
    cJSON *env = cJSON_CreateObject();
    if (!env) {
        cJSON_Delete(data);
        return NULL;
    }
    cJSON_AddStringToObject(env, "schema", schema);
    cJSON_AddStringToObject(env, "msgId", meta->msg_id);
    cJSON_AddNumberToObject(env, "seq", meta->seq);
    cJSON_AddNumberToObject(env, "bootId", id->boot_id);
    cJSON_AddStringToObject(env, "deviceId", id->device_id);
    cJSON_AddStringToObject(env, "machineId", id->machine_id);
    cJSON_AddStringToObject(env, "gatewayId", LDL_GATEWAY_NONE);
    cJSON_AddStringToObject(env, "source", LDL_SOURCE);
    add_ts(env, "ts", meta->ts_ms);
    cJSON_AddStringToObject(env, "tsQuality", meta->synced ? "SYNCED" : "ESTIMATED");
    cJSON_AddBoolToObject(env, "replayed", meta->replayed);
    cJSON_AddItemToObject(env, "data", data);
    char *out = cJSON_PrintUnformatted(env);
    cJSON_Delete(env);
    return out;
}

void ldl_contract_free(char *s)
{
    cJSON_free(s);
}

bool ldl_contract_msg_id(const char *json, char out[LDL_UUID_LEN])
{
    static const char key[] = "\"msgId\":\"";
    const char *p = json ? strstr(json, key) : NULL;
    if (!p) {
        return false;
    }
    p += sizeof(key) - 1;
    for (int i = 0; i < 36; i++) {
        if (!p[i] || p[i] == '"') {
            return false;
        }
        out[i] = p[i];
    }
    if (p[36] != '"') {
        return false;
    }
    out[36] = '\0';
    return true;
}

int ldl_batch_begin(char *buf, int cap, const char *device_id)
{
    int n = snprintf(buf, (size_t)cap, "{\"deviceId\":\"%s\",\"envelopes\":[", device_id);
    return (n < 0 || n >= cap) ? -1 : n;
}

int ldl_batch_add(char *buf, int cap, int used, int index, const char *envelope, bool replayed)
{
    static const char flag_false[] = "\"replayed\":false";
    static const char flag_true[] = "\"replayed\":true";
    const size_t len = strlen(envelope);
    /* +1 for comma, +1 for closing "]}" reserve handled in end() */
    if ((size_t)used + len + 1 + 3 > (size_t)cap) {
        return -1;
    }
    char *w = buf + used;
    if (index > 0) {
        *w++ = ',';
    }
    const char *hit = replayed ? strstr(envelope, flag_false) : NULL;
    if (hit) {
        size_t pre = (size_t)(hit - envelope);
        memcpy(w, envelope, pre);
        w += pre;
        memcpy(w, flag_true, sizeof(flag_true) - 1);
        w += sizeof(flag_true) - 1;
        const char *rest = hit + sizeof(flag_false) - 1;
        size_t rl = strlen(rest);
        memcpy(w, rest, rl);
        w += rl;
    } else {
        memcpy(w, envelope, len);
        w += len;
    }
    *w = '\0';
    return (int)(w - buf);
}

int ldl_batch_end(char *buf, int cap, int used)
{
    if (used + 3 > cap) {
        return -1;
    }
    memcpy(buf + used, "]}", 3);
    return used + 2;
}

int ldl_batch_parse_response(const char *json, int64_t *server_ms, ldl_result_t *res, int max)
{
    *server_ms = -1;
    cJSON *root = cJSON_Parse(json);
    if (!root) {
        return -1;
    }
    const cJSON *st = cJSON_GetObjectItemCaseSensitive(root, "serverTime");
    int64_t ms;
    if (cJSON_IsString(st) && ldl_iso_parse(st->valuestring, &ms)) {
        *server_ms = ms;
    }
    int n = 0;
    const cJSON *results = cJSON_GetObjectItemCaseSensitive(root, "results");
    const cJSON *r;
    cJSON_ArrayForEach(r, results)
    {
        if (n >= max) {
            break;
        }
        const cJSON *id = cJSON_GetObjectItemCaseSensitive(r, "msgId");
        const cJSON *status = cJSON_GetObjectItemCaseSensitive(r, "status");
        const cJSON *reason = cJSON_GetObjectItemCaseSensitive(r, "reason");
        if (!cJSON_IsString(id) || !cJSON_IsString(status)) {
            continue;
        }
        ldl_result_t *o = &res[n];
        memset(o, 0, sizeof(*o));
        strncpy(o->msg_id, id->valuestring, LDL_UUID_LEN - 1);
        if (strcmp(status->valuestring, "stored") == 0) {
            o->status = LDL_RES_STORED;
        } else if (strcmp(status->valuestring, "duplicate") == 0) {
            o->status = LDL_RES_DUPLICATE;
        } else if (strcmp(status->valuestring, "rejected") == 0) {
            o->status = LDL_RES_REJECTED;
        } else {
            o->status = LDL_RES_UNKNOWN;
        }
        if (cJSON_IsString(reason)) {
            strncpy(o->reason, reason->valuestring, sizeof(o->reason) - 1);
        }
        n++;
    }
    cJSON_Delete(root);
    return n;
}

uint32_t ldl_backoff_ms(uint32_t attempt)
{
    const uint32_t base = 2000, cap = 300000;
    if (attempt >= 8) {
        return cap;
    }
    uint32_t v = base << attempt;
    return v > cap ? cap : v;
}
