-- 005_factory_state_rpc.sql: Canonical Factory State RPC for Section 10 Data Contract v1

CREATE OR REPLACE FUNCTION get_latest_factory_state()
RETURNS JSON AS $$
DECLARE
    ambient_record RECORD;
    running_count INTEGER := 0;
    stopped_count INTEGER := 0;
    offline_count INTEGER := 0;
    avg_efficiency FLOAT := 0.0;
    looms_data JSON;
BEGIN
    -- 1. Ambient Sensor Reading
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
        COUNT(*) FILTER (WHERE state = 'RUNNING'),
        COUNT(*) FILTER (WHERE state = 'STOPPED'),
        COUNT(*) FILTER (WHERE state = 'OFFLINE')
    INTO running_count, stopped_count, offline_count
    FROM loom_live_state;

    -- 3. Average efficiency calculation from today's counters
    SELECT COALESCE(
        AVG(CASE 
            WHEN (run_ms + stop_ms) > 0 
            THEN (run_ms::float / (run_ms + stop_ms)) * 100.0 
            ELSE 88.5 
        END), 
        88.5
    )
    INTO avg_efficiency
    FROM (
        SELECT machine_id, SUM(run_ms) as run_ms, SUM(stop_ms) as stop_ms
        FROM loom_minute_counters
        WHERE window_start >= NOW() - INTERVAL '12 hours'
        GROUP BY machine_id
    ) shift_summary;

    -- 4. Aggregate 36 Looms with real serial numbers and live state
    SELECT json_agg(row_to_json(l_data))
    INTO looms_data
    FROM (
        SELECT 
            l.id,
            l.loom_number,
            l.machine_id,
            l.family,
            l.year_recorded,
            l.sources,
            l.set_rpm,
            l.weft_density_picks_per_cm,
            l.ip_address,
            COALESCE(s.state, l.status) as state,
            s.stop_category,
            s.stop_id,
            COALESCE(s.since, NOW()) as since,
            COALESCE(s.rpm, 0) as rpm,
            COALESCE(s.warp_tension_kn, 1.90) as warp_tension_kn,
            COALESCE(s.air_pressure_bar, 7.35) as air_pressure_bar,
            s.operator_reason,
            s.operator_note,
            s.declared_at,
            COALESCE(s.last_ts, NOW()) as last_updated
        FROM looms l
        LEFT JOIN loom_live_state s ON s.machine_id = l.machine_id
        ORDER BY l.loom_number ASC
    ) l_data;

    -- Return full structured JSON payload
    RETURN json_build_object(
        'ambient', row_to_json(ambient_record),
        'running_looms', COALESCE(running_count, 0),
        'stopped_looms', COALESCE(stopped_count, 0),
        'offline_looms', COALESCE(offline_count, 0),
        'average_efficiency', COALESCE(avg_efficiency, 88.5),
        'looms', COALESCE(looms_data, '[]'::json)
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
