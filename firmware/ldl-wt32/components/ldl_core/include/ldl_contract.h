/*
 * ldl_contract.h - Data Contract v1 encoder (contract/v1/README.md).
 * Produces envelopes byte-compatible (key order and types) with the golden
 * examples in contract/v1/examples. Pure C + cJSON.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "ldl_util.h"

#ifdef __cplusplus
extern "C" {
#endif

#define LDL_SCHEMA_STATE "ahi.loom.state/1.0"
#define LDL_SCHEMA_EVENT "ahi.loom.event/1.0"
#define LDL_SCHEMA_COUNTERS "ahi.loom.counters/1.0"
#define LDL_SCHEMA_HEALTH "ahi.device.health/1.0"
#define LDL_SOURCE "LDL"
#define LDL_GATEWAY_NONE "none"
#define LDL_MAX_BATCH 50

typedef enum {
    LDL_CAT_WARP = 0,
    LDL_CAT_FILLING,
    LDL_CAT_SELVEDGE,
    LDL_CAT_OTHER,
    LDL_CAT_COUNT,
    LDL_CAT_NONE = -1,
} ldl_stop_cat_t;

const char *ldl_cat_name(ldl_stop_cat_t c);

typedef struct {
    const char *device_id;  /* lowercase MAC hex, no colons */
    const char *machine_id; /* e.g. "PIC-427708" */
    uint32_t boot_id;
} ldl_identity_t;

typedef struct {
    char msg_id[LDL_UUID_LEN];
    uint32_t seq;
    int64_t ts_ms;
    bool synced; /* tsQuality SYNCED vs ESTIMATED */
    bool replayed;
} ldl_meta_t;

typedef enum {
    LDL_MSG_STATE = 0,
    LDL_MSG_STOP_STARTED,
    LDL_MSG_STOP_ENDED,
    LDL_MSG_START_FAILED,
    LDL_MSG_DISCONTINUITY,
    LDL_MSG_COUNTERS,
    LDL_MSG_HEALTH,
} ldl_msg_type_t;

typedef struct {
    bool running;
    ldl_stop_cat_t cat;          /* LDL_CAT_NONE while running -> null */
    char stop_id[LDL_UUID_LEN];  /* "" while running -> null */
    int64_t since_ms;
    double rpm;
    uint64_t picks_total;
} ldl_state_data_t;

typedef struct {
    char stop_id[LDL_UUID_LEN];
    ldl_stop_cat_t cat;
    int64_t detected_ms;
    uint64_t picks_total;
} ldl_stop_started_t;

typedef struct {
    char stop_id[LDL_UUID_LEN];
    ldl_stop_cat_t cat;
    int64_t duration_ms;
    uint32_t failed_attempts;
    uint64_t picks_total;
} ldl_stop_ended_t;

typedef struct {
    char stop_id[LDL_UUID_LEN];
    ldl_stop_cat_t cat;
    int64_t detected_ms; /* when the attempt stopped again */
    uint32_t attempt;    /* 1-based attempt number within this stop */
    uint32_t picks_in_attempt;
    uint64_t picks_total;
} ldl_start_failed_t;

typedef struct {
    int64_t detected_ms;
    const char *reason; /* e.g. "COUNTERS_LOST" */
    uint64_t picks_total;
} ldl_discontinuity_t;

typedef struct {
    int64_t window_start_ms;
    int64_t window_end_ms;
    uint64_t picks_delta;
    uint64_t picks_total;
    uint32_t run_ms;
    uint32_t stop_ms;
    uint32_t offline_ms;
    uint32_t stops[LDL_CAT_COUNT];
    double rpm_avg_running;
} ldl_counters_t;

typedef struct {
    const char *status; /* "ONLINE" */
    const char *ip_address;
    const char *firmware_version;
    uint32_t uptime_s;
    const char *last_error; /* NULL -> null */
    uint32_t boot_id;
    const char *buffer_type; /* "flash" */
    uint32_t buffer_backlog;
    bool clock_synced;
    bool link_up;
} ldl_health_t;

typedef struct {
    ldl_msg_type_t type;
    union {
        ldl_state_data_t state;
        ldl_stop_started_t stop_started;
        ldl_stop_ended_t stop_ended;
        ldl_start_failed_t start_failed;
        ldl_discontinuity_t discontinuity;
        ldl_counters_t counters;
        ldl_health_t health;
    } u;
} ldl_msg_t;

/** Encode one envelope as compact JSON. Caller frees with ldl_contract_free(). */
char *ldl_contract_encode(const ldl_identity_t *id, const ldl_meta_t *meta, const ldl_msg_t *msg);
void ldl_contract_free(char *s);

/** Round to one decimal (as used for rpm fields). */
double ldl_round1(double v);

/**
 * Locate the msgId value inside an encoded envelope. Copies 36 chars + NUL
 * into out. Returns false if not found.
 */
bool ldl_contract_msg_id(const char *json, char out[LDL_UUID_LEN]);

/* ---- uplink batch helpers ------------------------------------------------ */

/**
 * Build `{"deviceId":"..","envelopes":[` prefix / append one envelope / close.
 * The envelope text is copied verbatim; when replayed is true the first
 * `"replayed":false` occurrence is rewritten to `"replayed":true`.
 * Returns bytes written or -1 if cap would be exceeded.
 */
int ldl_batch_begin(char *buf, int cap, const char *device_id);
int ldl_batch_add(char *buf, int cap, int used, int index, const char *envelope, bool replayed);
int ldl_batch_end(char *buf, int cap, int used);

typedef enum {
    LDL_RES_UNKNOWN = 0,
    LDL_RES_STORED,
    LDL_RES_DUPLICATE,
    LDL_RES_REJECTED,
} ldl_result_status_t;

typedef struct {
    char msg_id[LDL_UUID_LEN];
    ldl_result_status_t status;
    char reason[96];
} ldl_result_t;

/**
 * Parse a batch response. Fills up to max results; *server_ms = -1 when
 * serverTime is absent/invalid. Returns number of results or -1 on bad JSON.
 */
int ldl_batch_parse_response(const char *json, int64_t *server_ms, ldl_result_t *res, int max);

/** Exponential backoff: 2 s doubling up to 5 min. attempt starts at 0. */
uint32_t ldl_backoff_ms(uint32_t attempt);

#ifdef __cplusplus
}
#endif
