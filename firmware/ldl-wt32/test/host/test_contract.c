/* Contract encoder vs golden files in contract/v1/examples. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cJSON.h"
#include "ldl_contract.h"
#include "unity.h"

static char *read_file(const char *name)
{
    char path[512];
    snprintf(path, sizeof(path), "%s/%s", CONTRACT_DIR, name);
    FILE *f = fopen(path, "rb");
    if (!f) {
        TEST_FAIL_MESSAGE(path);
        return NULL;
    }
    fseek(f, 0, SEEK_END);
    long n = ftell(f);
    fseek(f, 0, SEEK_SET);
    char *buf = malloc((size_t)n + 1);
    size_t got = fread(buf, 1, (size_t)n, f);
    buf[got] = '\0';
    fclose(f);
    return buf;
}

/* Canonical compact form of a JSON document (keeps key order). */
static char *canon(const char *json)
{
    cJSON *j = cJSON_Parse(json);
    TEST_ASSERT_NOT_NULL_MESSAGE(j, "invalid JSON");
    char *s = cJSON_PrintUnformatted(j);
    cJSON_Delete(j);
    return s;
}

static const ldl_identity_t ID = {
    .device_id = "e0e2e6aabbcc",
    .machine_id = "PIC-427708",
    .boot_id = 17,
};

static int64_t iso(const char *s)
{
    int64_t ms = 0;
    TEST_ASSERT_TRUE(ldl_iso_parse(s, &ms));
    return ms;
}

static ldl_meta_t meta(const char *msg_id, uint32_t seq, const char *ts)
{
    ldl_meta_t m = {.seq = seq, .ts_ms = iso(ts), .synced = true, .replayed = false};
    strcpy(m.msg_id, msg_id);
    return m;
}

static void assert_golden(const char *file, const ldl_meta_t *m, const ldl_msg_t *msg)
{
    char *golden = read_file(file);
    char *want = canon(golden);
    char *got = ldl_contract_encode(&ID, m, msg);
    TEST_ASSERT_NOT_NULL(got);
    TEST_ASSERT_EQUAL_STRING_MESSAGE(want, got, file);
    free(golden);
    cJSON_free(want);
    ldl_contract_free(got);
}

static ldl_msg_t msg_state(void)
{
    ldl_msg_t m = {.type = LDL_MSG_STATE};
    m.u.state.running = false;
    m.u.state.cat = LDL_CAT_WARP;
    strcpy(m.u.state.stop_id, "0193c8a2-5f0f-7c11-8a22-3b4c5d6e7f80");
    m.u.state.since_ms = iso("2026-11-26T09:15:02.120Z");
    m.u.state.rpm = 0;
    m.u.state.picks_total = 1534212;
    return m;
}

static ldl_msg_t msg_counters(void)
{
    ldl_msg_t m = {.type = LDL_MSG_COUNTERS};
    ldl_counters_t *c = &m.u.counters;
    c->window_start_ms = iso("2026-11-26T09:16:00.000Z");
    c->window_end_ms = iso("2026-11-26T09:17:00.000Z");
    c->picks_delta = 812;
    c->picks_total = 1535024;
    c->run_ms = 55800;
    c->stop_ms = 4200;
    c->offline_ms = 0;
    c->stops[LDL_CAT_WARP] = 1;
    c->rpm_avg_running = 812.0 * 60000.0 / 55800.0; /* 873.118.. -> 873.1 */
    return m;
}

static ldl_msg_t msg_health(void)
{
    ldl_msg_t m = {.type = LDL_MSG_HEALTH};
    ldl_health_t *h = &m.u.health;
    h->status = "ONLINE";
    h->ip_address = "10.20.30.41";
    h->firmware_version = "ldl-wt32 0.1.0";
    h->uptime_s = 86412;
    h->last_error = NULL;
    h->boot_id = 17;
    h->buffer_type = "flash";
    h->buffer_backlog = 0;
    h->clock_synced = true;
    h->link_up = true;
    return m;
}

static void test_golden_state(void)
{
    ldl_meta_t m = meta("0193c8a2-5f10-7a3b-9c4d-1a2b3c4d5e01", 1042, "2026-11-26T09:15:02.481Z");
    ldl_msg_t msg = msg_state();
    assert_golden("state.json", &m, &msg);
}

static void test_golden_stop_started(void)
{
    ldl_meta_t m = meta("0193c8a2-5f10-7a3b-9c4d-1a2b3c4d5e02", 1043, "2026-11-26T09:15:02.482Z");
    ldl_msg_t msg = {.type = LDL_MSG_STOP_STARTED};
    strcpy(msg.u.stop_started.stop_id, "0193c8a2-5f0f-7c11-8a22-3b4c5d6e7f80");
    msg.u.stop_started.cat = LDL_CAT_WARP;
    msg.u.stop_started.detected_ms = iso("2026-11-26T09:15:02.120Z");
    msg.u.stop_started.picks_total = 1534212;
    assert_golden("event_stop_started.json", &m, &msg);
}

static void test_golden_stop_ended(void)
{
    ldl_meta_t m = meta("0193c8a3-2b40-7e55-b311-1a2b3c4d5e03", 1051, "2026-11-26T09:16:10.004Z");
    ldl_msg_t msg = {.type = LDL_MSG_STOP_ENDED};
    strcpy(msg.u.stop_ended.stop_id, "0193c8a2-5f0f-7c11-8a22-3b4c5d6e7f80");
    msg.u.stop_ended.cat = LDL_CAT_WARP;
    msg.u.stop_ended.duration_ms = 67884;
    msg.u.stop_ended.failed_attempts = 0;
    msg.u.stop_ended.picks_total = 1534212;
    assert_golden("event_stop_ended.json", &m, &msg);
}

static void test_golden_counters(void)
{
    ldl_meta_t m = meta("0193c8a3-6a00-7f01-a000-1a2b3c4d5e04", 1060, "2026-11-26T09:17:00.010Z");
    ldl_msg_t msg = msg_counters();
    assert_golden("counters.json", &m, &msg);
}

static void test_golden_health(void)
{
    ldl_meta_t m = meta("0193c8a3-6a10-7f02-a000-1a2b3c4d5e05", 1061, "2026-11-26T09:17:00.250Z");
    ldl_msg_t msg = msg_health();
    assert_golden("health.json", &m, &msg);
}

/* Generated meta: everything except msgId/seq/ts must still match golden. */
static void test_generated_meta_matches_golden_shape(void)
{
    const uint8_t rnd[10] = {1, 2, 3, 4, 5, 6, 7, 8, 9, 10};
    ldl_meta_t m = {.seq = 1, .ts_ms = 1700000000123LL, .synced = true};
    ldl_uuid7_format(m.msg_id, (uint64_t)m.ts_ms, rnd);
    ldl_msg_t msg = msg_counters();
    char *got = ldl_contract_encode(&ID, &m, &msg);
    char *golden = read_file("counters.json");
    cJSON *a = cJSON_Parse(got);
    cJSON *b = cJSON_Parse(golden);
    TEST_ASSERT_TRUE(ldl_uuid7_valid(cJSON_GetObjectItem(a, "msgId")->valuestring));
    TEST_ASSERT_EQUAL_INT(1, cJSON_GetObjectItem(a, "seq")->valueint);
    const char *ignored[] = {"msgId", "seq", "ts"};
    for (int i = 0; i < 3; i++) {
        cJSON_DeleteItemFromObjectCaseSensitive(a, ignored[i]);
        cJSON_DeleteItemFromObjectCaseSensitive(b, ignored[i]);
    }
    char *sa = cJSON_PrintUnformatted(a);
    char *sb = cJSON_PrintUnformatted(b);
    TEST_ASSERT_EQUAL_STRING(sb, sa);
    cJSON_free(sa);
    cJSON_free(sb);
    cJSON_Delete(a);
    cJSON_Delete(b);
    free(golden);
    ldl_contract_free(got);
}

static void test_running_state_nulls_and_estimated(void)
{
    ldl_meta_t m = meta("0193c8a2-5f10-7a3b-9c4d-1a2b3c4d5e01", 1, "2026-11-26T09:15:02.481Z");
    m.synced = false;
    ldl_msg_t msg = {.type = LDL_MSG_STATE};
    msg.u.state.running = true;
    msg.u.state.cat = LDL_CAT_NONE;
    msg.u.state.since_ms = m.ts_ms;
    msg.u.state.rpm = 873.14;
    msg.u.state.picks_total = 10;
    char *got = ldl_contract_encode(&ID, &m, &msg);
    TEST_ASSERT_NOT_NULL(strstr(got, "\"tsQuality\":\"ESTIMATED\""));
    TEST_ASSERT_NOT_NULL(strstr(got,
        "\"data\":{\"state\":\"RUNNING\",\"stopCategory\":null,\"stopId\":null,"
        "\"since\":\"2026-11-26T09:15:02.481Z\",\"rpm\":873.1,\"picksTotal\":10}"));
    ldl_contract_free(got);
}

static void test_extra_events_shape(void)
{
    ldl_meta_t m = meta("0193c8a2-5f10-7a3b-9c4d-1a2b3c4d5e01", 2, "2026-11-26T09:15:02.481Z");
    ldl_msg_t f = {.type = LDL_MSG_START_FAILED};
    strcpy(f.u.start_failed.stop_id, "0193c8a2-5f0f-7c11-8a22-3b4c5d6e7f80");
    f.u.start_failed.cat = LDL_CAT_FILLING;
    f.u.start_failed.detected_ms = m.ts_ms;
    f.u.start_failed.attempt = 1;
    f.u.start_failed.picks_in_attempt = 3;
    f.u.start_failed.picks_total = 99;
    char *got = ldl_contract_encode(&ID, &m, &f);
    TEST_ASSERT_NOT_NULL(strstr(got, "\"schema\":\"ahi.loom.event/1.0\""));
    TEST_ASSERT_NOT_NULL(strstr(got, "\"eventType\":\"START_ATTEMPT_FAILED\""));
    ldl_contract_free(got);

    ldl_msg_t d = {.type = LDL_MSG_DISCONTINUITY};
    d.u.discontinuity.detected_ms = m.ts_ms;
    d.u.discontinuity.reason = "COUNTERS_LOST";
    got = ldl_contract_encode(&ID, &m, &d);
    TEST_ASSERT_NOT_NULL(strstr(got,
        "\"data\":{\"eventType\":\"COUNTER_DISCONTINUITY\",\"detectedAt\":\"2026-11-26T09:15:02.481Z\","
        "\"reason\":\"COUNTERS_LOST\",\"picksTotal\":0}"));
    ldl_contract_free(got);
}

static void test_batch_request_matches_golden(void)
{
    /* Rebuild batch_request.json from the four golden envelopes. */
    ldl_meta_t m1 = meta("0193c8a2-5f10-7a3b-9c4d-1a2b3c4d5e01", 1042, "2026-11-26T09:15:02.481Z");
    ldl_meta_t m2 = meta("0193c8a2-5f10-7a3b-9c4d-1a2b3c4d5e02", 1043, "2026-11-26T09:15:02.482Z");
    ldl_meta_t m3 = meta("0193c8a3-6a00-7f01-a000-1a2b3c4d5e04", 1060, "2026-11-26T09:17:00.010Z");
    ldl_meta_t m4 = meta("0193c8a3-6a10-7f02-a000-1a2b3c4d5e05", 1061, "2026-11-26T09:17:00.250Z");
    ldl_msg_t s = msg_state();
    ldl_msg_t e = {.type = LDL_MSG_STOP_STARTED};
    strcpy(e.u.stop_started.stop_id, "0193c8a2-5f0f-7c11-8a22-3b4c5d6e7f80");
    e.u.stop_started.cat = LDL_CAT_WARP;
    e.u.stop_started.detected_ms = iso("2026-11-26T09:15:02.120Z");
    e.u.stop_started.picks_total = 1534212;
    ldl_msg_t c = msg_counters();
    ldl_msg_t h = msg_health();
    char *env[4] = {
        ldl_contract_encode(&ID, &m1, &s),
        ldl_contract_encode(&ID, &m2, &e),
        ldl_contract_encode(&ID, &m3, &c),
        ldl_contract_encode(&ID, &m4, &h),
    };
    char buf[8192];
    int n = ldl_batch_begin(buf, sizeof(buf), "e0e2e6aabbcc");
    for (int i = 0; i < 4; i++) {
        n = ldl_batch_add(buf, sizeof(buf), n, i, env[i], false);
        TEST_ASSERT_TRUE(n > 0);
        ldl_contract_free(env[i]);
    }
    n = ldl_batch_end(buf, sizeof(buf), n);
    TEST_ASSERT_TRUE(n > 0);
    char *golden = read_file("batch_request.json");
    char *want = canon(golden);
    TEST_ASSERT_EQUAL_STRING(want, buf);
    cJSON_free(want);
    free(golden);
}

static void test_batch_replayed_rewrite_and_overflow(void)
{
    const char *env = "{\"msgId\":\"x\",\"replayed\":false,\"data\":{}}";
    char buf[128];
    int n = ldl_batch_begin(buf, sizeof(buf), "dev");
    n = ldl_batch_add(buf, sizeof(buf), n, 0, env, true);
    n = ldl_batch_end(buf, sizeof(buf), n);
    TEST_ASSERT_EQUAL_STRING(
        "{\"deviceId\":\"dev\",\"envelopes\":[{\"msgId\":\"x\",\"replayed\":true,\"data\":{}}]}", buf);
    char small[48];
    n = ldl_batch_begin(small, sizeof(small), "dev");
    TEST_ASSERT_EQUAL_INT(-1, ldl_batch_add(small, sizeof(small), n, 0, env, false));
}

static void test_msg_id_extract(void)
{
    char id[LDL_UUID_LEN];
    char *golden = read_file("state.json");
    char *compact = canon(golden);
    TEST_ASSERT_TRUE(ldl_contract_msg_id(compact, id));
    TEST_ASSERT_EQUAL_STRING("0193c8a2-5f10-7a3b-9c4d-1a2b3c4d5e01", id);
    TEST_ASSERT_FALSE(ldl_contract_msg_id("{\"x\":1}", id));
    cJSON_free(compact);
    free(golden);
}

static void test_parse_golden_response(void)
{
    char *golden = read_file("batch_response.json");
    ldl_result_t r[8];
    int64_t server_ms;
    int n = ldl_batch_parse_response(golden, &server_ms, r, 8);
    TEST_ASSERT_EQUAL_INT(4, n);
    TEST_ASSERT_EQUAL_INT64(iso("2026-11-26T09:17:00.391Z"), server_ms);
    TEST_ASSERT_EQUAL_STRING("0193c8a2-5f10-7a3b-9c4d-1a2b3c4d5e01", r[0].msg_id);
    TEST_ASSERT_EQUAL_INT(LDL_RES_STORED, r[0].status);
    TEST_ASSERT_EQUAL_INT(LDL_RES_DUPLICATE, r[1].status);
    TEST_ASSERT_EQUAL_INT(LDL_RES_STORED, r[2].status);
    TEST_ASSERT_EQUAL_INT(LDL_RES_REJECTED, r[3].status);
    TEST_ASSERT_EQUAL_STRING("machineId does not match device registration", r[3].reason);
    TEST_ASSERT_EQUAL_INT(-1, ldl_batch_parse_response("not json", &server_ms, r, 8));
    free(golden);
}

void run_contract_tests(void)
{
    RUN_TEST(test_golden_state);
    RUN_TEST(test_golden_stop_started);
    RUN_TEST(test_golden_stop_ended);
    RUN_TEST(test_golden_counters);
    RUN_TEST(test_golden_health);
    RUN_TEST(test_generated_meta_matches_golden_shape);
    RUN_TEST(test_running_state_nulls_and_estimated);
    RUN_TEST(test_extra_events_shape);
    RUN_TEST(test_batch_request_matches_golden);
    RUN_TEST(test_batch_replayed_rewrite_and_overflow);
    RUN_TEST(test_msg_id_extract);
    RUN_TEST(test_parse_golden_response);
}
