-- 006_contract_v1.sql: Data Contract v1 HTTP ingest (device registry, health, idempotent ingest RPC)
-- Idempotent: safe to run more than once. Requires 001_initial_schema.sql.
-- NOTE: 002_downtime_trigger.sql and 005_factory_state_rpc.sql reference tables/columns
-- that do not exist (loom_id, stop_code, factory_ambient_telemetry). They are left untouched
-- and are NOT required by this migration.

-- ---------------------------------------------------------------------------
-- 1. Device registry (one row per logger; only the SHA-256 of its token is stored)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    device_id    TEXT PRIMARY KEY,
    machine_id   TEXT NOT NULL REFERENCES looms(machine_id) ON UPDATE CASCADE ON DELETE CASCADE,
    token_hash   TEXT NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
    status       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS devices_machine_id_idx ON devices (machine_id);

-- ---------------------------------------------------------------------------
-- 2. Latest health report per device
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS device_health (
    device_id        TEXT PRIMARY KEY REFERENCES devices(device_id) ON DELETE CASCADE,
    machine_id       TEXT,
    ts               TIMESTAMPTZ NOT NULL,
    received_at      TIMESTAMPTZ NOT NULL,
    status           TEXT,
    ip_address       TEXT,
    firmware_version TEXT,
    uptime_seconds   BIGINT,
    last_error       TEXT,
    boot_id          INTEGER,
    buffer_type      TEXT,
    buffer_backlog   INTEGER,
    clock_synced     BOOLEAN,
    link_up          BOOLEAN,
    ts_quality       TEXT
);

-- ---------------------------------------------------------------------------
-- 3. Ordering / audit columns on existing tables
-- ---------------------------------------------------------------------------
ALTER TABLE loom_live_state ADD COLUMN IF NOT EXISTS hw_ts      TIMESTAMPTZ;
ALTER TABLE loom_live_state ADD COLUMN IF NOT EXISTS hw_boot_id INTEGER;
ALTER TABLE loom_live_state ADD COLUMN IF NOT EXISTS hw_seq     BIGINT;
ALTER TABLE loom_live_state ADD COLUMN IF NOT EXISTS ts_quality TEXT;
-- (loom_live_state.total_picks from 001 holds picksTotal)

ALTER TABLE loom_events ADD COLUMN IF NOT EXISTS boot_id     INTEGER;
ALTER TABLE loom_events ADD COLUMN IF NOT EXISTS received_at TIMESTAMPTZ;
ALTER TABLE loom_events ADD COLUMN IF NOT EXISTS schema      TEXT;
ALTER TABLE loom_events ADD COLUMN IF NOT EXISTS ts_quality  TEXT;
CREATE INDEX IF NOT EXISTS loom_events_machine_ts_idx ON loom_events (machine_id, ts DESC);

-- ---------------------------------------------------------------------------
-- 4. Row level security
-- ---------------------------------------------------------------------------
ALTER TABLE devices ENABLE ROW LEVEL SECURITY;
ALTER TABLE device_health ENABLE ROW LEVEL SECURITY;
-- devices holds token hashes: no public policies at all (service_role bypasses RLS).
REVOKE ALL ON TABLE devices FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON TABLE devices FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON TABLE devices FROM authenticated';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'device_health'
                   AND policyname = 'Allow public read access on device health') THEN
        CREATE POLICY "Allow public read access on device health" ON device_health FOR SELECT USING (true);
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 5. ingest_message(): one envelope, one transaction, idempotent on msg_id.
--    Returns 'stored' | 'duplicate' | 'stale' | 'rejected'.
--    p_env is a contract v1 envelope (validated by the API). Optional server-added
--    key "clockSkewed": true => ts was >5 min in the future; received_at is used for ordering.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.ingest_message(p_env JSONB, p_received_at TIMESTAMPTZ)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_received   TIMESTAMPTZ := COALESCE(p_received_at, NOW());
    v_schema     TEXT        := p_env->>'schema';
    v_msg_id     UUID        := (p_env->>'msgId')::uuid;
    v_device_id  TEXT        := p_env->>'deviceId';
    v_machine_id TEXT        := p_env->>'machineId';
    v_ts         TIMESTAMPTZ := (p_env->>'ts')::timestamptz;
    v_seq        BIGINT      := (p_env->>'seq')::bigint;
    v_boot_id    INTEGER     := (p_env->>'bootId')::integer;
    v_replayed   BOOLEAN     := COALESCE((p_env->>'replayed')::boolean, false);
    v_ts_quality TEXT        := COALESCE(p_env->>'tsQuality', 'ESTIMATED');
    v_data       JSONB       := COALESCE(p_env->'data', '{}'::jsonb);
    v_skewed     BOOLEAN;
    v_order_ts   TIMESTAMPTZ;
    v_event_type TEXT;
    v_reg_machine TEXT;
    v_rows       INTEGER;
    v_status     TEXT := 'stored';
    v_stop_id    UUID;
    v_dur_ms     BIGINT;
BEGIN
    IF v_msg_id IS NULL OR v_device_id IS NULL OR v_machine_id IS NULL OR v_ts IS NULL THEN
        RETURN 'rejected';
    END IF;

    -- Device must exist, be active and be bound to this machine.
    SELECT machine_id INTO v_reg_machine
      FROM devices WHERE device_id = v_device_id AND status = 'active';
    IF NOT FOUND OR v_reg_machine IS DISTINCT FROM v_machine_id THEN
        RETURN 'rejected';
    END IF;

    v_event_type := CASE v_schema
        WHEN 'ahi.loom.state/1.0'    THEN 'STATE'
        WHEN 'ahi.loom.counters/1.0' THEN 'COUNTERS'
        WHEN 'ahi.device.health/1.0' THEN 'HEALTH'
        WHEN 'ahi.loom.event/1.0'    THEN NULLIF(v_data->>'eventType', '')
        ELSE NULL END;
    IF v_event_type IS NULL THEN
        RETURN 'rejected';
    END IF;

    -- Skew rule (also enforced by the API): never trust a clock > 5 min ahead.
    v_skewed := COALESCE((p_env->>'clockSkewed')::boolean, false)
                OR v_ts > v_received + INTERVAL '5 minutes';
    IF v_skewed THEN
        v_ts_quality := 'ESTIMATED';
        v_order_ts := v_received;
    ELSE
        v_order_ts := v_ts;
    END IF;

    -- Liveness = server receive time (also for duplicates: the logger is reachable).
    UPDATE devices SET last_seen_at = v_received
     WHERE device_id = v_device_id AND (last_seen_at IS NULL OR last_seen_at < v_received);
    UPDATE looms SET last_heartbeat_at = v_received
     WHERE machine_id = v_machine_id AND (last_heartbeat_at IS NULL OR last_heartbeat_at < v_received);

    -- Idempotency: msg_id is the primary key of the history table.
    INSERT INTO loom_events (msg_id, machine_id, device_id, gateway_id, source, event_type,
                             event_data, ts, seq, replayed, boot_id, received_at, schema, ts_quality)
    VALUES (v_msg_id, v_machine_id, v_device_id, p_env->>'gatewayId', p_env->>'source', v_event_type,
            v_data, v_ts, v_seq, v_replayed, v_boot_id, v_received, v_schema, v_ts_quality)
    ON CONFLICT (msg_id) DO NOTHING;
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    IF v_rows = 0 THEN
        RETURN 'duplicate';
    END IF;

    IF v_schema = 'ahi.loom.state/1.0' THEN
        IF v_replayed THEN
            v_status := 'stale';  -- replayed state is history only, never the live view
        ELSE
            INSERT INTO loom_live_state AS s (machine_id, device_id, state, stop_category, stop_id, since,
                                              rpm, total_picks, last_ts, replayed, updated_at,
                                              hw_ts, hw_boot_id, hw_seq, ts_quality)
            VALUES (v_machine_id, v_device_id, v_data->>'state', v_data->>'stopCategory',
                    NULLIF(v_data->>'stopId', '')::uuid,
                    CASE WHEN v_skewed THEN v_received
                         ELSE COALESCE((v_data->>'since')::timestamptz, v_ts) END,
                    ROUND(COALESCE((v_data->>'rpm')::numeric, 0))::integer,
                    COALESCE((v_data->>'picksTotal')::bigint, 0),
                    v_order_ts, false, v_received,
                    v_order_ts, v_boot_id, v_seq, v_ts_quality)
            ON CONFLICT (machine_id) DO UPDATE SET
                device_id     = EXCLUDED.device_id,
                state         = EXCLUDED.state,
                stop_category = EXCLUDED.stop_category,
                stop_id       = EXCLUDED.stop_id,
                since         = EXCLUDED.since,
                rpm           = EXCLUDED.rpm,
                total_picks   = EXCLUDED.total_picks,
                last_ts       = EXCLUDED.last_ts,
                replayed      = false,
                updated_at    = EXCLUDED.updated_at,
                hw_ts         = EXCLUDED.hw_ts,
                hw_boot_id    = EXCLUDED.hw_boot_id,
                hw_seq        = EXCLUDED.hw_seq,
                ts_quality    = EXCLUDED.ts_quality,
                -- a new stop clears any previous operator declaration
                operator_reason = CASE WHEN s.stop_id IS DISTINCT FROM EXCLUDED.stop_id
                                       THEN NULL ELSE s.operator_reason END,
                operator_note   = CASE WHEN s.stop_id IS DISTINCT FROM EXCLUDED.stop_id
                                       THEN NULL ELSE s.operator_note END,
                declared_at     = CASE WHEN s.stop_id IS DISTINCT FROM EXCLUDED.stop_id
                                       THEN NULL ELSE s.declared_at END
            WHERE s.hw_ts IS NULL
               OR (EXCLUDED.hw_ts, EXCLUDED.hw_boot_id, EXCLUDED.hw_seq)
                  > (s.hw_ts, COALESCE(s.hw_boot_id, -1), COALESCE(s.hw_seq, -1));
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows = 0 THEN
                v_status := 'stale';  -- older than what the live view already shows
            ELSE
                UPDATE looms SET status = v_data->>'state' WHERE machine_id = v_machine_id;
            END IF;
        END IF;

    ELSIF v_schema = 'ahi.loom.counters/1.0' THEN
        INSERT INTO loom_minute_counters (machine_id, window_start, window_end, picks_delta, picks_total,
                                          run_ms, stop_ms, offline_ms, stops_warp, stops_filling,
                                          stops_selvedge, stops_other, rpm_avg_running, source)
        VALUES (v_machine_id,
                (v_data->>'windowStart')::timestamptz, (v_data->>'windowEnd')::timestamptz,
                (v_data->>'picksDelta')::integer, (v_data->>'picksTotal')::bigint,
                (v_data->>'runMs')::integer, (v_data->>'stopMs')::integer, (v_data->>'offlineMs')::integer,
                COALESCE((v_data->'stops'->>'WARP')::integer, 0),
                COALESCE((v_data->'stops'->>'FILLING')::integer, 0),
                COALESCE((v_data->'stops'->>'SELVEDGE')::integer, 0),
                COALESCE((v_data->'stops'->>'OTHER')::integer, 0),
                COALESCE((v_data->>'rpmAvgRunning')::numeric, 0),
                COALESCE(p_env->>'source', 'LDL'))
        ON CONFLICT (machine_id, window_start) DO UPDATE SET
            window_end      = EXCLUDED.window_end,
            picks_delta     = EXCLUDED.picks_delta,
            picks_total     = EXCLUDED.picks_total,
            run_ms          = EXCLUDED.run_ms,
            stop_ms         = EXCLUDED.stop_ms,
            offline_ms      = EXCLUDED.offline_ms,
            stops_warp      = EXCLUDED.stops_warp,
            stops_filling   = EXCLUDED.stops_filling,
            stops_selvedge  = EXCLUDED.stops_selvedge,
            stops_other     = EXCLUDED.stops_other,
            rpm_avg_running = EXCLUDED.rpm_avg_running,
            source          = EXCLUDED.source;

    ELSIF v_schema = 'ahi.loom.event/1.0' THEN
        v_stop_id := NULLIF(v_data->>'stopId', '')::uuid;

        IF v_event_type = 'STOP_STARTED' THEN
            INSERT INTO downtime_logs (stop_id, machine_id, stop_category, downtime_start)
            VALUES (v_stop_id, v_machine_id, COALESCE(v_data->>'stopCategory', 'OTHER'),
                    CASE WHEN v_skewed THEN v_received
                         ELSE COALESCE((v_data->>'detectedAt')::timestamptz, v_ts) END)
            ON CONFLICT (stop_id) DO NOTHING;

        ELSIF v_event_type = 'STOP_ENDED' THEN
            v_dur_ms := (v_data->>'durationMs')::bigint;
            UPDATE downtime_logs d SET
                downtime_end          = v_order_ts,
                duration_ms           = COALESCE(v_dur_ms,
                                          GREATEST(0, (EXTRACT(EPOCH FROM (v_order_ts - d.downtime_start)) * 1000)::bigint)),
                duration_minutes      = ROUND(COALESCE(v_dur_ms,
                                          GREATEST(0, (EXTRACT(EPOCH FROM (v_order_ts - d.downtime_start)) * 1000)::bigint))
                                          / 60000.0, 2),
                failed_start_attempts = COALESCE((v_data->>'failedStartAttempts')::integer, d.failed_start_attempts)
            WHERE d.id = (
                SELECT id FROM downtime_logs
                 WHERE machine_id = v_machine_id
                   AND ((v_stop_id IS NOT NULL AND stop_id = v_stop_id)
                     OR (v_stop_id IS NULL AND downtime_end IS NULL))
                 ORDER BY downtime_start DESC
                 LIMIT 1);
            GET DIAGNOSTICS v_rows = ROW_COUNT;
            IF v_rows = 0 AND v_stop_id IS NOT NULL THEN
                -- STOP_ENDED arrived before (or without) STOP_STARTED: reconstruct the stop.
                INSERT INTO downtime_logs (stop_id, machine_id, stop_category, downtime_start, downtime_end,
                                           duration_ms, duration_minutes, failed_start_attempts)
                VALUES (v_stop_id, v_machine_id, COALESCE(v_data->>'stopCategory', 'OTHER'),
                        v_order_ts - make_interval(secs => COALESCE(v_dur_ms, 0) / 1000.0),
                        v_order_ts, COALESCE(v_dur_ms, 0), ROUND(COALESCE(v_dur_ms, 0) / 60000.0, 2),
                        COALESCE((v_data->>'failedStartAttempts')::integer, 0))
                ON CONFLICT (stop_id) DO NOTHING;
            END IF;
        END IF;
        -- START_ATTEMPT_FAILED / COUNTER_DISCONTINUITY: history (loom_events) only.

    ELSIF v_schema = 'ahi.device.health/1.0' THEN
        INSERT INTO device_health AS h (device_id, machine_id, ts, received_at, status, ip_address,
                                        firmware_version, uptime_seconds, last_error, boot_id,
                                        buffer_type, buffer_backlog, clock_synced, link_up, ts_quality)
        VALUES (v_device_id, v_machine_id, v_order_ts, v_received, v_data->>'status', v_data->>'ipAddress',
                v_data->>'firmwareVersion', (v_data->>'uptimeSeconds')::bigint, v_data->>'lastError',
                (v_data->>'bootId')::integer, v_data->>'bufferType', (v_data->>'bufferBacklog')::integer,
                (v_data->>'clockSynced')::boolean, (v_data->>'linkUp')::boolean, v_ts_quality)
        ON CONFLICT (device_id) DO UPDATE SET
            machine_id       = EXCLUDED.machine_id,
            ts               = EXCLUDED.ts,
            received_at      = EXCLUDED.received_at,
            status           = EXCLUDED.status,
            ip_address       = EXCLUDED.ip_address,
            firmware_version = EXCLUDED.firmware_version,
            uptime_seconds   = EXCLUDED.uptime_seconds,
            last_error       = EXCLUDED.last_error,
            boot_id          = EXCLUDED.boot_id,
            buffer_type      = EXCLUDED.buffer_type,
            buffer_backlog   = EXCLUDED.buffer_backlog,
            clock_synced     = EXCLUDED.clock_synced,
            link_up          = EXCLUDED.link_up,
            ts_quality       = EXCLUDED.ts_quality
        WHERE (EXCLUDED.ts, EXCLUDED.boot_id) >= (h.ts, COALESCE(h.boot_id, -1));

        IF NOT v_replayed THEN
            UPDATE looms SET
                ip_address       = COALESCE(v_data->>'ipAddress', ip_address),
                firmware_version = COALESCE(v_data->>'firmwareVersion', firmware_version)
             WHERE machine_id = v_machine_id;
        END IF;
    END IF;

    RETURN v_status;
END;
$$;

REVOKE ALL ON FUNCTION public.ingest_message(JSONB, TIMESTAMPTZ) FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.ingest_message(JSONB, TIMESTAMPTZ) FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.ingest_message(JSONB, TIMESTAMPTZ) FROM authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.ingest_message(JSONB, TIMESTAMPTZ) TO service_role';
    END IF;
END $$;

-- ---------------------------------------------------------------------------
-- 6. provision_device(): create/update the loom + bind a device with a new token hash.
--    Used by scripts/provision-device.mjs (service_role only). The plaintext token
--    never reaches the database. Re-provisioning a device rotates its token.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.provision_device(
    p_device_id   TEXT,
    p_machine_id  TEXT,
    p_token_hash  TEXT,
    p_loom_number INTEGER DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    IF p_machine_id !~ '^PIC-[A-Za-z0-9]{1,32}$' THEN
        RAISE EXCEPTION 'machine_id must look like PIC-<serial>';
    END IF;
    IF p_token_hash !~ '^[0-9a-f]{64}$' THEN
        RAISE EXCEPTION 'token_hash must be 64 lowercase hex chars (SHA-256)';
    END IF;

    INSERT INTO looms (machine_id, loom_number, sources)
    VALUES (p_machine_id, p_loom_number, ARRAY['LDL']::text[])
    ON CONFLICT (machine_id) DO UPDATE
        SET loom_number = COALESCE(EXCLUDED.loom_number, looms.loom_number);

    INSERT INTO devices (device_id, machine_id, token_hash, status)
    VALUES (p_device_id, p_machine_id, p_token_hash, 'active')
    ON CONFLICT (device_id) DO UPDATE
        SET machine_id = EXCLUDED.machine_id,
            token_hash = EXCLUDED.token_hash,
            status     = 'active';
END;
$$;

REVOKE ALL ON FUNCTION public.provision_device(TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.provision_device(TEXT, TEXT, TEXT, INTEGER) FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE 'REVOKE ALL ON FUNCTION public.provision_device(TEXT, TEXT, TEXT, INTEGER) FROM authenticated';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        EXECUTE 'GRANT EXECUTE ON FUNCTION public.provision_device(TEXT, TEXT, TEXT, INTEGER) TO service_role';
    END IF;
END $$;

-- Disable a logger (e.g. lost/stolen):  UPDATE devices SET status = 'disabled' WHERE device_id = '<id>';
