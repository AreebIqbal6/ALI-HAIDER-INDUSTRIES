-- 001_initial_schema.sql: Section 10 (Data Contract v1) Schema & Machine Registry for Ali Haider Industries

-- 1. LOOMS MASTER REGISTRY (36 Real Machines + Dynamic Scalability)
CREATE TABLE IF NOT EXISTS looms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    machine_id VARCHAR(50) NOT NULL UNIQUE, -- Canonical e.g. "PIC-427708"
    loom_number INTEGER NOT NULL UNIQUE CHECK (loom_number >= 1),
    family VARCHAR(50) NOT NULL CHECK (family IN ('OmniPlus-i', 'OmniPlus Summum', 'OmniPlus 800')),
    year_recorded VARCHAR(20),
    sources TEXT[] NOT NULL DEFAULT ARRAY['LDL']::text[],
    set_rpm INTEGER NOT NULL DEFAULT 850,
    weft_density_picks_per_cm NUMERIC(5, 2) NOT NULL DEFAULT 27.2,
    ip_address VARCHAR(45),
    status VARCHAR(20) NOT NULL DEFAULT 'RUNNING' CHECK (status IN ('RUNNING', 'STOPPED', 'OFFLINE', 'UNKNOWN')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 2. REAL-TIME LOOM STATE (ahi.loom.state/1.0 & ahi.loom.process/1.0)
CREATE TABLE IF NOT EXISTS loom_live_state (
    machine_id VARCHAR(50) PRIMARY KEY REFERENCES looms(machine_id) ON DELETE CASCADE,
    state VARCHAR(20) NOT NULL DEFAULT 'RUNNING' CHECK (state IN ('RUNNING', 'STOPPED', 'OFFLINE', 'UNKNOWN')),
    stop_category VARCHAR(20) CHECK (stop_category IN ('WARP', 'FILLING', 'SELVEDGE', 'OTHER')),
    stop_id UUID,
    since TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    rpm INTEGER NOT NULL DEFAULT 0,
    warp_tension_kn NUMERIC(5, 2) DEFAULT 1.90,
    air_pressure_bar NUMERIC(5, 2) DEFAULT 7.35,
    operator_reason VARCHAR(10) CHECK (operator_reason IN ('ART', 'KNT', 'ELE', 'MEC', 'BST', 'DOF', 'OLS')),
    operator_note TEXT,
    declared_at TIMESTAMP WITH TIME ZONE,
    last_ts TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    replayed BOOLEAN DEFAULT false,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 3. 1-MINUTE COUNTER WINDOWS (ahi.loom.counters/1.0)
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
    source VARCHAR(30) DEFAULT 'LDL',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE (machine_id, window_start)
);

-- 4. CANONICAL LOOM EVENTS (ahi.loom.event/1.0 with UUIDv7 Idempotency)
CREATE TABLE IF NOT EXISTS loom_events (
    msg_id UUID PRIMARY KEY, -- Idempotency key
    machine_id VARCHAR(50),
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

-- 6. GATEWAY & DEVICE HEALTH (Liveness tracking > 90s)
CREATE TABLE IF NOT EXISTS gateway_health (
    gateway_id VARCHAR(50) PRIMARY KEY,
    last_seen_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
    status VARCHAR(20) NOT NULL DEFAULT 'ONLINE',
    connected_devices INTEGER DEFAULT 0,
    metadata JSONB DEFAULT '{}'::jsonb,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- 7. WEAVING SHED AMBIENT & SOLAR TELEMETRY
CREATE TABLE IF NOT EXISTS factory_ambient_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    main_air_pressure_bar NUMERIC(5, 2) NOT NULL,
    hall_temperature_celsius NUMERIC(5, 2) NOT NULL,
    hall_humidity_percentage NUMERIC(5, 2) NOT NULL,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS solar_live_telemetry (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    current_generation_kw NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    daily_yield_kwh NUMERIC(10, 2) NOT NULL DEFAULT 0.00,
    factory_load_kw NUMERIC(10, 2) NOT NULL DEFAULT 315.00,
    recorded_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- 8. ROW LEVEL SECURITY (RLS) POLICIES
ALTER TABLE looms ENABLE ROW LEVEL SECURITY;
ALTER TABLE loom_live_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE loom_minute_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE loom_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE downtime_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE long_stop_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE gateway_health ENABLE ROW LEVEL SECURITY;
ALTER TABLE factory_ambient_telemetry ENABLE ROW LEVEL SECURITY;
ALTER TABLE solar_live_telemetry ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access on looms" ON looms FOR SELECT USING (true);
CREATE POLICY "Allow public read access on live state" ON loom_live_state FOR SELECT USING (true);
CREATE POLICY "Allow public read access on counters" ON loom_minute_counters FOR SELECT USING (true);
CREATE POLICY "Allow public read access on events" ON loom_events FOR SELECT USING (true);
CREATE POLICY "Allow public read access on downtime" ON downtime_logs FOR SELECT USING (true);
CREATE POLICY "Allow public read access on declarations" ON long_stop_declarations FOR SELECT USING (true);
CREATE POLICY "Allow public read access on gateway health" ON gateway_health FOR SELECT USING (true);
CREATE POLICY "Allow public read access on ambient" ON factory_ambient_telemetry FOR SELECT USING (true);
CREATE POLICY "Allow public read access on solar" ON solar_live_telemetry FOR SELECT USING (true);

CREATE POLICY "Allow all on looms" ON looms FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on live state" ON loom_live_state FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on counters" ON loom_minute_counters FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on events" ON loom_events FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on downtime" ON downtime_logs FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on declarations" ON long_stop_declarations FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on gateway health" ON gateway_health FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on ambient" ON factory_ambient_telemetry FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on solar" ON solar_live_telemetry FOR ALL USING (true) WITH CHECK (true);

-- 9. SEED THE REAL 36 PICANOL LOOMS AT ALI HAIDER INDUSTRIES
INSERT INTO looms (loom_number, machine_id, family, year_recorded, sources, set_rpm, weft_density_picks_per_cm, ip_address, status)
VALUES
  -- 2x OmniPlus Summum (2012/2015)
  (1, 'PIC-332235', 'OmniPlus Summum', '11/2012', ARRAY['LDL', 'BICOM_ETH'], 850, 27.2, '192.168.10.101', 'RUNNING'),
  (2, 'PIC-315816', 'OmniPlus Summum', '05/2015', ARRAY['LDL', 'BICOM_ETH'], 850, 27.2, '192.168.10.102', 'RUNNING'),

  -- 25x OmniPlus-i (07-08/2021)
  (3,  'PIC-427708', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.103', 'RUNNING'),
  (4,  'PIC-427709', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.104', 'STOPPED'),
  (5,  'PIC-427710', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.105', 'RUNNING'),
  (6,  'PIC-427711', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.106', 'RUNNING'),
  (7,  'PIC-427712', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.107', 'RUNNING'),
  (8,  'PIC-427713', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.108', 'RUNNING'),
  (9,  'PIC-427714', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.109', 'RUNNING'),
  (10, 'PIC-427715', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.110', 'RUNNING'),
  (11, 'PIC-427716', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.111', 'STOPPED'),
  (12, 'PIC-427717', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.112', 'RUNNING'),
  (13, 'PIC-427718', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.113', 'RUNNING'),
  (14, 'PIC-427719', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.114', 'RUNNING'),
  (15, 'PIC-427720', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.115', 'RUNNING'),
  (16, 'PIC-427721', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.116', 'RUNNING'),
  (17, 'PIC-427722', 'OmniPlus-i', '07/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.117', 'RUNNING'),
  (18, 'PIC-427723', 'OmniPlus-i', '08/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.118', 'RUNNING'),
  (19, 'PIC-427724', 'OmniPlus-i', '08/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.119', 'STOPPED'),
  (20, 'PIC-427725', 'OmniPlus-i', '08/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.120', 'RUNNING'),
  (21, 'PIC-427726', 'OmniPlus-i', '08/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.121', 'RUNNING'),
  (22, 'PIC-427727', 'OmniPlus-i', '08/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.122', 'RUNNING'),
  (23, 'PIC-427728', 'OmniPlus-i', '08/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.123', 'RUNNING'),
  (24, 'PIC-427729', 'OmniPlus-i', '08/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.124', 'RUNNING'),
  (25, 'PIC-427730', 'OmniPlus-i', '08/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.125', 'RUNNING'),
  (26, 'PIC-427731', 'OmniPlus-i', '08/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.126', 'RUNNING'),
  (27, 'PIC-427732', 'OmniPlus-i', '08/2021', ARRAY['LDL', 'BICOM_ETH'], 874, 27.2, '192.168.10.127', 'RUNNING'),

  -- 9x OmniPlus 800 (09/2005-02/2006)
  (28, 'PIC-279327', 'OmniPlus 800', '09/2005', ARRAY['LDL'], 501, 38.2, '192.168.20.128', 'RUNNING'),
  (29, 'PIC-278863', 'OmniPlus 800', '09/2005', ARRAY['LDL'], 501, 38.2, '192.168.20.129', 'STOPPED'),
  (30, 'PIC-279323', 'OmniPlus 800', '09/2005', ARRAY['LDL'], 501, 38.2, '192.168.20.130', 'RUNNING'),
  (31, 'PIC-279105', 'OmniPlus 800', '09/2005', ARRAY['LDL'], 501, 38.2, '192.168.20.131', 'RUNNING'),
  (32, 'PIC-279099', 'OmniPlus 800', '09/2005', ARRAY['LDL'], 501, 38.2, '192.168.20.132', 'RUNNING'),
  (33, 'PIC-281560', 'OmniPlus 800', '02/2006', ARRAY['LDL'], 501, 38.2, '192.168.20.133', 'RUNNING'),
  (34, 'PIC-281554', 'OmniPlus 800', '02/2006', ARRAY['LDL'], 501, 38.2, '192.168.20.134', 'STOPPED'),
  (35, 'PIC-281553', 'OmniPlus 800', '02/2006', ARRAY['LDL'], 501, 38.2, '192.168.20.135', 'RUNNING'),
  (36, 'PIC-281481', 'OmniPlus 800', '02/2006', ARRAY['LDL'], 501, 38.2, '192.168.20.136', 'RUNNING')
ON CONFLICT (machine_id) DO UPDATE 
SET 
  loom_number = EXCLUDED.loom_number, 
  family = EXCLUDED.family, 
  set_rpm = EXCLUDED.set_rpm, 
  sources = EXCLUDED.sources;

-- Seed initial real-time state for each registered machine
INSERT INTO loom_live_state (machine_id, state, stop_category, rpm, since, last_ts)
SELECT 
    l.machine_id,
    l.status,
    CASE WHEN l.status = 'STOPPED' THEN 'WARP' ELSE NULL END,
    CASE WHEN l.status = 'RUNNING' THEN l.set_rpm ELSE 0 END,
    NOW(),
    NOW()
FROM looms l
ON CONFLICT (machine_id) DO NOTHING;
