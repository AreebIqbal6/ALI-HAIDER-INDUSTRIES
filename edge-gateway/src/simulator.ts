import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import { OFFICIAL_FLEET_36, generateUuidV7 } from './mock-devices';
import { CanonicalEnvelope, LoomStateData, LoomCountersData } from './index';

dotenv.config();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing Supabase URL or Key in environment variables.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function startSimulator() {
  console.log("🚀 Starting Section 10 Canonical Simulator (Ali Haider Industries - 36 Real Looms)...");

  // Seed / Verify the 36 Real Machines in registry
  const fleetPayload = OFFICIAL_FLEET_36.map(def => ({
    loom_number: def.loomNumber,
    machine_id: def.machineId,
    family: def.family,
    year_recorded: def.yearRecorded,
    sources: def.sources,
    set_rpm: def.setRpm,
    weft_density_picks_per_cm: def.weftDensity,
    ip_address: def.ipAddress,
    status: 'RUNNING'
  }));

  const { error: seedErr } = await supabase
    .from('looms')
    .upsert(fleetPayload, { onConflict: 'machine_id' });

  if (seedErr) {
    console.warn("Notice: Looms seed warning:", seedErr.message);
  } else {
    console.log("✅ Verified 36 Canonical Picanol machines in database registry.");
  }

  // High-frequency telemetry stream loop
  setInterval(async () => {
    const timestamp = new Date().toISOString();

    const ambientPayload = {
      main_air_pressure_bar: Number((7.35 + (Math.random() * 0.2 - 0.1)).toFixed(2)),
      hall_temperature_celsius: 27.8,
      hall_humidity_percentage: 68.2,
      recorded_at: timestamp
    };

    const hour = new Date().getHours();
    const solarKw = (hour >= 6 && hour <= 18) ? 190 + Math.random() * 25 : 0;
    const solarPayload = {
      current_generation_kw: Number(solarKw.toFixed(1)),
      daily_yield_kwh: 1250,
      factory_load_kw: 315,
      recorded_at: timestamp
    };

    try {
      await Promise.all([
        supabase.from('factory_ambient_telemetry').insert(ambientPayload),
        supabase.from('solar_live_telemetry').insert(solarPayload),
        supabase.from('gateway_health').upsert({
          gateway_id: 'AHI-GW-01',
          last_seen_at: timestamp,
          status: 'ONLINE',
          connected_devices: 36
        }, { onConflict: 'gateway_id' })
      ]);
      console.log(`📡 [EMIT] Ambient: ${ambientPayload.hall_temperature_celsius}°C, Air: ${ambientPayload.main_air_pressure_bar}b | Solar: ${solarPayload.current_generation_kw}kW`);
    } catch (err: any) {
      console.error("Simulation error:", err.message);
    }
  }, 3000);
}

startSimulator();
