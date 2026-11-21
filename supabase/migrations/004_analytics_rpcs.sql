-- 004_analytics_rpcs.sql: Shift Analytics RPCs for Ali Haider Industries
-- Zero-Mock Implementation: Dynamically computes metrics strictly from connected looms and real data.

CREATE OR REPLACE FUNCTION calculate_shift_kpis(
    p_shift_date DATE DEFAULT (NOW() AT TIME ZONE 'Asia/Karachi')::date,
    p_shift_type TEXT DEFAULT 'CURRENT'
)
RETURNS JSON
LANGUAGE plpgsql
AS $$
DECLARE
    now_pkt TIMESTAMP WITH TIME ZONE := NOW() AT TIME ZONE 'Asia/Karachi';
    current_hour INTEGER := EXTRACT(HOUR FROM now_pkt);
    active_shift_type TEXT;
    shift_start_utc TIMESTAMP WITH TIME ZONE;
    shift_end_utc TIMESTAMP WITH TIME ZONE;
    elapsed_shift_ms BIGINT;
    total_shift_ms BIGINT := 12 * 60 * 60 * 1000; -- 12 hours = 43,200,000 ms

    connected_looms_count INTEGER := 0;
    total_run_ms BIGINT := 0;
    total_stop_ms BIGINT := 0;
    total_offline_ms BIGINT := 0;
    total_picks_delta BIGINT := 0;
    stops_warp_count BIGINT := 0;
    stops_filling_count BIGINT := 0;
    stops_selvedge_count BIGINT := 0;
    stops_other_count BIGINT := 0;
    total_stops_count BIGINT := 0;
    total_metres NUMERIC(12, 2) := 0.00;

    efficiency_pct NUMERIC(5, 2) := 0.00;
    avg_rpm NUMERIC(6, 1) := 0.0;
    cmpx NUMERIC(6, 2) := 0.00;
    mtbf_mins NUMERIC(8, 1) := 0.0;
    mttr_mins NUMERIC(8, 1) := 0.0;
    result JSON;
BEGIN
    -- 1. Determine shift boundaries
    IF p_shift_type = 'CURRENT' THEN
        IF current_hour >= 8 AND current_hour < 20 THEN
            active_shift_type := 'SHIFT_A';
        ELSE
            active_shift_type := 'SHIFT_B';
        END IF;
    ELSE
        active_shift_type := p_shift_type;
    END IF;

    IF active_shift_type = 'SHIFT_A' THEN
        -- 08:00 PKT to 20:00 PKT -> 03:00 UTC to 15:00 UTC on shift_date
        shift_start_utc := (p_shift_date::text || ' 03:00:00+00')::timestamptz;
        shift_end_utc := (p_shift_date::text || ' 15:00:00+00')::timestamptz;
    ELSE
        -- 20:00 PKT to 08:00 PKT -> 15:00 UTC to 03:00 UTC next day
        shift_start_utc := (p_shift_date::text || ' 15:00:00+00')::timestamptz;
        shift_end_utc := (shift_start_utc + INTERVAL '12 hours');
    END IF;

    -- Calculate elapsed ms in active shift
    IF NOW() < shift_start_utc THEN
        elapsed_shift_ms := 1;
    ELSIF NOW() > shift_end_utc THEN
        elapsed_shift_ms := total_shift_ms;
    ELSE
        elapsed_shift_ms := GREATEST(1, EXTRACT(EPOCH FROM (NOW() - shift_start_utc)) * 1000);
    END IF;

    -- Count actual registered looms
    SELECT COUNT(*) INTO connected_looms_count FROM looms;

    -- 2. Aggregate 1-minute counters for all looms in the window
    IF connected_looms_count > 0 THEN
        SELECT 
            COALESCE(SUM(c.run_ms), 0),
            COALESCE(SUM(c.stop_ms), 0),
            COALESCE(SUM(c.offline_ms), 0),
            COALESCE(SUM(c.picks_delta), 0),
            COALESCE(SUM(c.stops_warp), 0),
            COALESCE(SUM(c.stops_filling), 0),
            COALESCE(SUM(c.stops_selvedge), 0),
            COALESCE(SUM(c.stops_other), 0),
            COALESCE(SUM(c.picks_delta / (l.weft_density_picks_per_cm * 100.0)), 0.0)
        INTO 
            total_run_ms,
            total_stop_ms,
            total_offline_ms,
            total_picks_delta,
            stops_warp_count,
            stops_filling_count,
            stops_selvedge_count,
            stops_other_count,
            total_metres
        FROM loom_minute_counters c
        JOIN looms l ON l.machine_id = c.machine_id
        WHERE c.window_start >= shift_start_utc AND c.window_end <= shift_end_utc;

        total_stops_count := stops_warp_count + stops_filling_count + stops_selvedge_count + stops_other_count;

        -- 3. Calculate verified KPI Formulas
        -- Efficiency % = (sum(runMs) / (elapsed_shift_ms * connected_looms_count)) * 100
        IF (elapsed_shift_ms * connected_looms_count) > 0 THEN
            efficiency_pct := ROUND(
                LEAST(100.0, GREATEST(0.0, (total_run_ms::numeric / (elapsed_shift_ms * connected_looms_count)::numeric) * 100.0)), 
                2
            );
        END IF;

        -- Average RPM = sum(picksDelta) / (sum(runMs) / 60000.0)
        IF total_run_ms > 0 THEN
            avg_rpm := ROUND((total_picks_delta::numeric / (total_run_ms::numeric / 60000.0)), 1);
        END IF;

        -- Stops per 10^5 Picks (CMPX) = (stops / sum(picksDelta)) * 100000
        IF total_picks_delta > 0 THEN
            cmpx := ROUND(((total_stops_count::numeric / total_picks_delta::numeric) * 100000.0), 2);
        END IF;

        -- MTBF (Mean Time Between Failures in Minutes) = (sum(runMs) / 60000) / stops
        IF total_stops_count > 0 THEN
            mtbf_mins := ROUND(((total_run_ms::numeric / 60000.0) / total_stops_count::numeric), 1);
            mttr_mins := ROUND(((total_stop_ms::numeric / 60000.0) / total_stops_count::numeric), 1);
        ELSIF total_run_ms > 0 THEN
            mtbf_mins := ROUND((total_run_ms::numeric / 60000.0), 1);
            mttr_mins := 0.0;
        END IF;
    END IF;

    -- Construct JSON
    result := json_build_object(
        'shift_name', CASE WHEN active_shift_type = 'SHIFT_A' THEN 'Shift A (08:00–20:00 PKT)' ELSE 'Shift B (20:00–08:00 PKT)' END,
        'shift_type', active_shift_type,
        'shift_start_utc', shift_start_utc,
        'shift_end_utc', shift_end_utc,
        'elapsed_ms', elapsed_shift_ms,
        'connected_looms', connected_looms_count,
        'efficiency_percentage', efficiency_pct,
        'average_rpm', avg_rpm,
        'total_picks', total_picks_delta,
        'metres_woven', ROUND(total_metres, 2),
        'cmpx', cmpx,
        'mtbf_minutes', mtbf_mins,
        'mttr_minutes', mttr_mins,
        'total_stops', total_stops_count,
        'stops_by_category', json_build_object(
            'WARP', stops_warp_count,
            'FILLING', stops_filling_count,
            'SELVEDGE', stops_selvedge_count,
            'OTHER', stops_other_count
        )
    );

    RETURN result;
END;
$$;
