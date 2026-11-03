-- 002_downtime_trigger.sql: Automatic Picanol Downtime & Stoppage Logging

CREATE OR REPLACE FUNCTION handle_loom_downtime()
RETURNS TRIGGER AS $$
BEGIN
    -- Case 1: Loom transitions to STOP
    IF (NEW.status = 'STOP' OR NEW.status LIKE 'STOP%') AND (OLD.status = 'RUN' OR OLD.status = 'RUNNING') THEN
        INSERT INTO downtime_logs (loom_id, stop_reason, downtime_start)
        VALUES (
            NEW.loom_id, 
            COALESCE(NEW.stop_code, 'UNSPECIFIED_STOP'), 
            NOW()
        );
    END IF;

    -- Case 2: Loom resumes running
    IF (NEW.status = 'RUN' OR NEW.status = 'RUNNING') AND (OLD.status = 'STOP' OR OLD.status LIKE 'STOP%') THEN
        UPDATE downtime_logs
        SET 
            downtime_end = NOW(),
            duration_minutes = ROUND(EXTRACT(EPOCH FROM (NOW() - downtime_start)) / 60.0, 2)
        WHERE loom_id = NEW.loom_id AND downtime_end IS NULL;
    END IF;

    -- Always refresh last_updated
    NEW.last_updated = NOW();
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS loom_downtime_trigger ON loom_live_telemetry;
CREATE TRIGGER loom_downtime_trigger
BEFORE UPDATE ON loom_live_telemetry
FOR EACH ROW
EXECUTE FUNCTION handle_loom_downtime();
