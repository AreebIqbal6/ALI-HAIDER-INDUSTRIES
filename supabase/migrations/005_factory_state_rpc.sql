-- 005_factory_state_rpc.sql: Canonical Factory State RPC for WeaveSync SCADA
-- Zero-Mock Implementation: Returns real metrics, empty array when 0 looms connected.

CREATE OR REPLACE FUNCTION get_latest_factory_state()
RETURNS JSON AS $$
DECLARE
    ambient_record RECORD;
    running_count INTEGER := 0;
    stopped_count INTEGER := 0;
    offline_count INTEGER := 0;
    total_looms INTEGER := 0;
    avg_efficiency FLOAT := NULL;
    looms_data JSON := '[]'::json;
BEGIN
    -- 1. Ambient Sensor Reading (only if available)
    SELECT 
        main_air_pressure_bar as air_pressure_bar, 
        hall_temperature_celsius as temperature_c, 
        hall_humidity_percentage as humidity_percent, 
        recorded_at
    INTO ambient_record 
    FROM factory_ambient_telemetry 
    ORDER BY recorded_at DESC 
    LIMIT 1;

    -- 2. State counts
    SELECT 
        COUNT(*),
        COUNT(*) FILTER (WHERE state = 'RUNNING'),
        COUNT(*) FILTER (WHERE state = 'STOPPED'),
        COUNT(*) FILTER (WHERE state = 'OFFLINE')
    INTO total_looms, running_count, stopped_count, offline_count
    FROM loom_live_state;

    -- 3. Average efficiency calculation from today's counters
    IF total_looms > 0 THEN
        SELECT AVG((run_ms::float / NULLIF(run_ms + stop_ms, 0)) * 100.0)
        INTO avg_efficiency
        FROM (
            SELECT machine_id, SUM(run_ms) as run_ms, SUM(stop_ms) as stop_ms
            FROM loom_minute_counters
            WHERE window_start >= NOW() - INTERVAL '12 hours'
            GROUP BY machine_id
        ) shift_summary
        WHERE (run_ms + stop_ms) > 0;
    END IF;

    -- 4. Aggregate connected looms with real telemetry
    SELECT json_agg(row_to_json(l_data))
    INTO looms_data
    FROM (
        SELECT 
            l.id,
            l.loom_number,
            l.machine_id,
            l.device_id,
            l.family,
            l.year_recorded,
            l.article_name,
            l.sources,
            l.set_rpm,
            l.weft_density_picks_per_cm,
            l.ip_address,
            l.firmware_version,
            COALESCE(s.state, l.status, 'OFFLINE') as state,
            s.stop_category,
            s.stop_id,
            COALESCE(s.since, NOW()) as since,
            COALESCE(s.rpm, 0) as rpm,
            COALESCE(s.total_picks, 0) as total_picks,
            COALESCE(s.meters_woven, 0.00) as meters_woven,
            s.warp_tension_kn,
            s.air_pressure_bar,
            s.raw_pins,
            s.operator_reason,
            s.operator_note,
            s.declared_at,
            l.last_heartbeat_at,
            COALESCE(s.last_ts, NOW()) as last_updated
        FROM looms l
        LEFT JOIN loom_live_state s ON s.machine_id = l.machine_id
        ORDER BY l.loom_number ASC NULLS LAST, l.machine_id ASC
    ) l_data;

    -- Return full structured JSON payload
    RETURN json_build_object(
        'ambient', CASE WHEN ambient_record.recorded_at IS NOT NULL THEN row_to_json(ambient_record) ELSE NULL END,
        'total_looms', total_looms,
        'running_looms', COALESCE(running_count, 0),
        'stopped_looms', COALESCE(stopped_count, 0),
        'offline_looms', COALESCE(offline_count, 0),
        'average_efficiency', avg_efficiency,
        'looms', COALESCE(looms_data, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
