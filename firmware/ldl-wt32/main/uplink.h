/*
 * uplink.h - HTTPS batch delivery of outbox records to
 * <url>/api/ingest/v1/batch with a bearer token.
 *  200: per-msgId results; stored|duplicate|rejected are deleted from flash.
 *  401/403: pause 5 min.   429/5xx/network: backoff 2 s .. 5 min.
 */
#pragma once

#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

/** Create the uplink task; returns its handle (store notifies it on append). */
TaskHandle_t uplink_start(void);
