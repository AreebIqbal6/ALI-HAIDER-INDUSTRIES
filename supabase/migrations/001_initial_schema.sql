-- 001_initial_schema.sql: Section 10 (Data Contract v1) Schema & Machine Registry for Ali Haider Industries
-- Strict Zero-Mock SCADA: Tables are created clean. No machines exist until hardware handshakes.

-- 1. LOOMS MASTER REGISTRY (Auto-Registered & Operator Labeled)
CREATE TABLE IF NOT EXISTS looms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id VARCHAR(50) NOT NULL UNIQUE, -- Canonical e.g. "PIC-427708" or "LOOM-E0E2E6"
    device_id VARCHAR(50) UNIQUE,           -- Real hardware MAC address e.g. "E0:E2:E6:AA:BB:CC"
    loom_number INTEGER UNIQUE CHECK (loom_number >= 1),
    family VARCHAR(50) NOT NULL DEFAULT 'OmniPlus-i',
    year_recorded VARCHAR(20),
    article_name VARCHAR(100) DEFAULT 'Standard Weave',
    sources TEXT[] NOT NULL DEFAULT ARRAY['HARDWARE']::text[],
    set_rpm INTEGER NOT NULL DEFAULT 850,
    weft_density_picks_per_cm NUMERIC(5, 2) NOT NULL DEFAULT 27.2,
    ip_address VARCHAR(45),
    firmware_version VARCHAR(50),
    status VARCHAR(20) NOT NULL DEFAULT 'OFFLINE' CHECK (status IN ('RUNNING', 'STOPPED', 'OFFLINE', 'UNKNOWN')),
    last_heartbeat_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. REAL-TIME LOOM STATE (Live Hardware Telemetry)
CREATE TABLE IF NOT EXISTS loom_live_state (
    machine_id VARCHAR(50) PRIMARY KEY REFERENCES looms(machine_id) ON DELETE CASCADE,
    device_id VARCHAR(50),
    state VARCHAR(20) NOT NULL DEFAULT 'OFFLINE' CHECK (state IN ('RUNNING', 'STOPPED', 'OFFLINE', 'UNKNOWN')),
    stop_category VARCHAR(20) CHECK (stop_category IN ('WARP', 'FILLING', 'SELVEDGE', 'OTHER')),
    stop_id UUID,
    since TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    rpm INTEGER NOT NULL DEFAULT 0,
    total_picks BIGINT NOT NULL DEFAULT 0,
    meters_woven NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    warp_tension_kn NUMERIC(5, 2),
    air_pressure_bar NUMERIC(5, 2),
    raw_pins JSONB DEFAULT '{}'::jsonb,
    operator_reason VARCHAR(10) CHECK (operator_reason IN ('ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS')),
    operator_note TEXT,
    declared_at TIMESTAMP WITH TIME ZONE,
    last_ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    replayed BOOLEAN DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 1-MINUTE COUNTER WINDOWS
CREATE TABLE IF NOT EXISTS loom_minute_counters (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id VARCHAR(50) NOT NULL REFERENCES looms(machine_id) ON DELETE CASCADE,
    window_start TIMESTAMP WITH TIME ZONE NOT NULL,
    window_end TIMESTAMP WITH TIME ZONE NOT NULL,
    picks_delta INTEGER NOT NULL DEFAULT 0,
    picks_total BIGINT NOT NULL DEFAULT 0,
    run_ms INTEGER NOT NULL DEFAULT 0,
    stop_ms INTEGER NOT NULL DEFAULT 0,
    offline_ms INTEGER NOT NULL DEFAULT 0,
    stops_warp INTEGER NOT NULL DEFAULT 0,
    stops_filling INTEGER NOT NULL DEFAULT 0,
    stops_selvedge INTEGER NOT NULL DEFAULT 0,
    stops_other INTEGER NOT NULL DEFAULT 0,
    rpm_avg_running NUMERIC(6, 1) DEFAULT 0,
    source VARCHAR(30) DEFAULT 'WT32-ETH01',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (machine_id, window_start)
);

-- 4. CANONICAL LOOM EVENTS (UUIDv7 / Sequence Idempotency)
CREATE TABLE IF NOT EXISTS loom_events (
    msg_id UUID PRIMARY KEY,
    machine_id VARCHAR(50),
    device_id VARCHAR(50),
    gateway_id VARCHAR(50),
    source VARCHAR(30),
    event_type VARCHAR(50) NOT NULL,
    event_data JSONB NOT NULL DEFAULT '{}'::jsonb,
    ts TIMESTAMP WITH TIME ZONE NOT NULL,
    seq BIGINT,
    replayed BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 5. DOWNTIME OCCURRENCES & OPERATOR DECLARATIONS
CREATE TABLE IF NOT EXISTS downtime_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stop_id UUID UNIQUE,
    machine_id VARCHAR(50) NOT NULL REFERENCES looms(machine_id) ON DELETE CASCADE,
    stop_category VARCHAR(20) NOT NULL,
    downtime_start TIMESTAMP WITH TIME ZONE NOT NULL,
    downtime_end TIMESTAMP WITH TIME ZONE,
    duration_minutes NUMERIC(8, 2) DEFAULT 0.0,
    duration_ms BIGINT DEFAULT 0,
    failed_start_attempts INTEGER DEFAULT 0,
    operator_reason VARCHAR(10) CHECK (operator_reason IN ('ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS')),
    acknowledged_by VARCHAR(100),
    technician_notes TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS long_stop_declarations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    stop_id UUID,
    machine_id VARCHAR(50) NOT NULL REFERENCES looms(machine_id) ON DELETE CASCADE,
    reason_code VARCHAR(10) NOT NULL CHECK (reason_code IN ('ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS')),
    reason_description VARCHAR(100) NOT NULL,
    declared_by VARCHAR(100) NOT NULL,
    notes TEXT,
    declared_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 6. GATEWAY & DEVICE HEALTH
CREATE TABLE IF NOT EXISTS gateway_health (
    gateway_id VARCHAR(50) PRIMARY KEY,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'ONLINE',
    connected_devices INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE looms ENABLE ROW LEVEL SECURITY;
ALTER TABLE loom_live_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE loom_minute_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE loom_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE downtime_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE long_stop_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gateway_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on looms" ON looms FOR SELECT USING (true);
CREATE POLICY "Allow public read access on live state" ON loom_live_state FOR SELECT USING (true);
CREATE POLICY "Allow public read access on counters" ON loom_minute_counters FOR SELECT USING (true);
CREATE POLICY "Allow public read access on events" ON loom_events FOR SELECT USING (true);
CREATE POLICY "Allow public read access on downtime" ON downtime_logs FOR SELECT USING (true);
CREATE POLICY "Allow public read access on declarations" ON long_stop_declarations FOR SELECT USING (true);
CREATE POLICY "Allow public read access on gateway health" ON gateway_health FOR SELECT USING (true);

-- Writes restricted to service_role and backend API
CREATE POLICY "Allow service role all on looms" ON looms FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres' OR current_user = 'service_role') WITH CHECK (true);
CREATE POLICY "Allow service role all on live state" ON loom_live_state FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres' OR current_user = 'service_role') WITH CHECK (true);
CREATE POLICY "Allow service role all on counters" ON loom_minute_counters FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres' OR current_user = 'service_role') WITH CHECK (true);
CREATE POLICY "Allow service role all on events" ON loom_events FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres' OR current_user = 'service_role') WITH CHECK (true);
CREATE POLICY "Allow service role all on downtime" ON downtime_logs FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres' OR current_user = 'service_role') WITH CHECK (true);
CREATE POLICY "Allow service role all on declarations" ON long_stop_declarations FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres' OR current_user = 'service_role') WITH CHECK (true);
CREATE POLICY "Allow service role all on gateway health" ON gateway_health FOR ALL USING (auth.role() = 'service_role' OR current_user = 'postgres' OR current_user = 'service_role') WITH CHECK (true);
