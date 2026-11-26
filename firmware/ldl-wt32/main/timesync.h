/*
 * timesync.h - wall clock for envelopes.
 *  SYNCED    : SNTP has synchronised the system clock.
 *  ESTIMATED : uptime + offset learnt from the last server `serverTime`, or
 *              plain uptime since the epoch if the server was never reached.
 */
#pragma once

#include <stdbool.h>
#include <stdint.h>

void timesync_init(const char *server);

/** Current wall clock in unix ms; *synced tells SYNCED vs ESTIMATED. */
int64_t timesync_now_ms(bool *synced);

/** Feed serverTime (unix ms) from an ingest response; rtt_ms halves into the estimate. */
void timesync_server_time(int64_t server_ms, int64_t rtt_ms);

bool timesync_synced(void);
