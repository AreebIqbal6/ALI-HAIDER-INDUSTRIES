-- 003_shift_metrics_view.sql: Section 11 Verified 12-Hour Shift Metrics View

-- Drop legacy view if exists
DROP VIEW IF EXISTS loom_shift_metrics;

-- Create high-performance shift aggregation view over loom_minute_counters
-- Aligned with Ali Haider Industries 12-Hour Shifts:
-- Shift A: 08:00 - 20:00 PKT (03:00 - 15:00 UTC)
-- Shift B: 20:00 - 08:00 PKT (15:00 - 03:00 UTC next day)
CREATE OR REPLACE VIEW loom_shift_metrics AS
WITH current_shift_boundary AS (
    SELECT 
        CASE 
            -- Shift A: 08:00 to 20:00 PKT (03:00 to 15:00 UTC)
            WHEN EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Karachi')) >= 8 
             AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Karachi')) < 20 
            THEN ((NOW() AT TIME ZONE 'Asia/Karachi')::date::text || ' 03:00:00+00')::timestamptz
            
            -- Shift B: After 20:00 PKT (15:00 UTC)
            WHEN EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Karachi')) >= 20
            THEN ((NOW() AT TIME ZONE 'Asia/Karachi')::date::text || ' 15:00:00+00')::timestamptz
            
            -- Shift B: Before 08:00 PKT (Started yesterday at 15:00 UTC)
            ELSE (((NOW() AT TIME ZONE 'Asia/Karachi')::date - INTERVAL '1 day')::date::text || ' 15:00:00+00')::timestamptz
        END AS shift_start_utc,
        CASE 
            WHEN EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Karachi')) >= 8 
             AND EXTRACT(HOUR FROM (NOW() AT TIME ZONE 'Asia/Karachi')) < 20 
            THEN 'SHIFT_A'
            ELSE 'SHIFT_B'
        END AS shift_name
),
shift_elapsed AS (
    SELECT 
        shift_start_utc,
        shift_name,
        GREATEST(1, EXTRACT(EPOCH FROM (NOW() - shift_start_utc)) * 1000) AS elapsed_shift_ms
    FROM current_shift_boundary
)
SELECT 
    l.machine_id,
    l.loom_number,
    l.family,
    l.set_rpm,
    l.weft_density_picks_per_cm,
    se.shift_name,
    se.shift_start_utc AS shift_start,
    COALESCE(SUM(c.picks_delta), 0) AS shift_picks,
    ROUND(COALESCE(SUM(c.picks_delta / (l.weft_density_picks_per_cm * 100.0)), 0.0), 2) AS shift_meters,
    COALESCE(SUM(c.run_ms), 0) AS run_ms,
    COALESCE(SUM(c.stop_ms), 0) AS stop_ms,
    COALESCE(SUM(c.offline_ms), 0) AS offline_ms,
    -- Section 11 Verified Efficiency %: (runMs / elapsedShiftMs) * 100
    ROUND(
        LEAST(100.0, (COALESCE(SUM(c.run_ms), 0)::numeric / NULLIF(se.elapsed_shift_ms, 0)) * 100.0), 
        2
    ) AS efficiency_pct,
    -- Section 11 Verified Running RPM: picks / (runMs / 60000)
    ROUND(
        CASE 
            WHEN COALESCE(SUM(c.run_ms), 0) > 0 
            THEN (COALESCE(SUM(c.picks_delta), 0)::numeric / (SUM(c.run_ms)::numeric / 60000.0))
            ELSE 0.0 
        END, 
        1
    ) AS avg_rpm_running,
    COALESCE(SUM(c.stops_warp), 0) AS stops_warp,
    COALESCE(SUM(c.stops_filling), 0) AS stops_filling,
    COALESCE(SUM(c.stops_selvedge), 0) AS stops_selvedge,
    COALESCE(SUM(c.stops_other), 0) AS stops_other,
    COALESCE(SUM(c.stops_warp + c.stops_filling + c.stops_selvedge + c.stops_other), 0) AS total_stops
FROM looms l
CROSS JOIN shift_elapsed se
LEFT JOIN loom_minute_counters c 
    ON c.machine_id = l.machine_id 
   AND c.window_start >= se.shift_start_utc
GROUP BY 
    l.machine_id, 
    l.loom_number, 
    l.family, 
    l.set_rpm, 
    l.weft_density_picks_per_cm, 
    se.shift_name, 
    se.shift_start_utc, 
    se.elapsed_shift_ms;

-- Grant access to view
GRANT SELECT ON loom_shift_metrics TO authenticated;
GRANT SELECT ON loom_shift_metrics TO anon;
GRANT SELECT ON loom_shift_metrics TO service_role;
