/*
 * store.h - flash persistence (Option B, no FRAM):
 *   journal partition (subtype 0x40): ldl_journal counter records
 *   outbox  partition (subtype 0x41): ldl_outbox message ring
 * A dedicated store task performs all flash writes, so producers (loom task)
 * never block on flash and the IRAM input ISR keeps running throughout.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

#include "esp_err.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "ldl_journal.h"
#include "ldl_util.h"

/** Open partitions, restore the newest journal record into *last (returns have_last). */
esp_err_t store_init(uint32_t boot_id, ldl_journal_rec_t *last, bool *have_last);

/** Start the writer task. uplink is notified after every append. */
void store_start(TaskHandle_t uplink);

/** Queue an encoded envelope (ownership passes to the store; freed with cJSON_free). */
bool store_enqueue(char *json);

/** Latest lifetime counters for the journal (written every interval by the store task). */
void store_journal_snapshot(uint64_t picks_total, uint64_t run_ms, uint64_t stop_ms);

uint32_t store_backlog(void);

typedef struct {
    uint32_t rid;
    char msg_id[LDL_UUID_LEN];
} store_batch_entry_t;

/**
 * Build an ingest batch body from the oldest pending records (max entries,
 * bounded by cap). Records from an earlier boot are sent with replayed=true.
 * Returns number of envelopes (0 = nothing pending), *len = body length.
 */
int store_build_batch(char *buf, int cap, int *len, const char *device_id, store_batch_entry_t *ents,
                      int max);

/** Delete (acknowledge) all pending records up to and including rid. */
void store_ack_through(uint32_t rid);
