/**
 * ==============================================================================
 * WEAVESYNC SCADA - 6-STEP PILOT & ZERO-MOCK VERIFICATION TEST SUITE
 * Client: Ali Haider Industries (Faisalabad, Pakistan)
 * Target: Zero-Mock Ingest Bridge, Auto-Registration & Dual-Mode Telemetry
 * ==============================================================================
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';
const INGEST_KEY = process.env.INGEST_API_KEY || 'weavesync-industrial-secret-2026';
const TEST_MAC = 'E0:E2:E6:99:88:77';
const TEST_MACHINE_ID = 'TEST-LOOM-998877';

async function runStep(name, fn) {
  process.stdout.write(`[TEST] ${name}... `);
  try {
    await fn();
    console.log('\x1b[32mPASSED\x1b[0m');
    return true;
  } catch (err) {
    console.log('\x1b[31mFAILED\x1b[0m');
    console.error(`       Error: ${err.message}`);
    return false;
  }
}

async function verifySuite() {
  console.log('==============================================================================');
  console.log('  WEAVESYNC SCADA - ZERO-MOCK PILOT VERIFICATION SUITE');
  console.log(`  Target Server: ${BASE_URL}`);
  console.log('==============================================================================\n');

  let passed = 0;
  const total = 6;

  // STEP 1: Local State Store Endpoint Verification
  const step1 = await runStep('Step 1: Check Local Telemetry Endpoint (GET /api/live/state)', async () => {
    const res = await fetch(`${BASE_URL}/api/live/state`);
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    const data = await res.json();
    if (data.mode !== 'LOCAL_LAN') throw new Error(`Expected mode LOCAL_LAN, got: ${data.mode}`);
    if (typeof data.totalLooms !== 'number') throw new Error('Missing totalLooms field');
  });
  if (step1) passed++;

  // STEP 2: Authenticated Hardware Handshake & Auto-Registration
  const step2 = await runStep('Step 2: Authenticated Hardware Handshake & Auto-Registration', async () => {
    const payload = {
      deviceId: TEST_MAC,
      machineId: TEST_MACHINE_ID,
      ip: '192.168.10.199',
      fw: 'v2.1-pilot',
      seq: 1,
      pins: { piStrt: 1, piPp: 1, piWd: 0, piFd: 0 },
      rpm: 874,
      picksDelta: 25,
      rawPinHistory: [
        { pin: 'PI_PP', level: 1, offsetMsFromStop: -150 },
        { pin: 'PI_STRT', level: 1, offsetMsFromStop: 0 }
      ]
    };

    const res = await fetch(`${BASE_URL}/api/ingest/v1/batch`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-weavesync-key': INGEST_KEY
      },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.success) throw new Error(`Response success was false`);

    // Verify machine auto-registered in local store
    const stateRes = await fetch(`${BASE_URL}/api/live/state`);
    const stateData = await stateRes.json();
    const registered = stateData.looms.find(l => l.machine_id === TEST_MACHINE_ID || l.device_id === TEST_MAC);
    if (!registered) throw new Error(`Loom ${TEST_MACHINE_ID} was not auto-registered in live store`);
    if (registered.status !== 'RUNNING') throw new Error(`Expected RUNNING status, got: ${registered.status}`);
  });
  if (step2) passed++;

  // STEP 3: Stop Classifier Hierarchy Verification
  const step3 = await runStep('Step 3: Stop Classifier Hierarchy (FILLING > WARP priority)', async () => {
    const stopPayload = {
      deviceId: TEST_MAC,
      machineId: TEST_MACHINE_ID,
      pins: { piStrt: 0, piPp: 0, piWd: 1, piFd: 1 }, // Both tripped
      rpm: 0
    };

    const res = await fetch(`${BASE_URL}/api/ingest/v1/batch`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'x-weavesync-key': INGEST_KEY
      },
      body: JSON.stringify(stopPayload)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const stateRes = await fetch(`${BASE_URL}/api/live/state`);
    const stateData = await stateRes.json();
    const loom = stateData.looms.find(l => l.machine_id === TEST_MACHINE_ID);
    if (loom?.liveState?.stop_category !== 'FILLING') {
      throw new Error(`Expected FILLING priority, got: ${loom?.liveState?.stop_category}`);
    }
  });
  if (step3) passed++;

  // STEP 4: Operator Stop Reason Logging (ISO 22971 Code)
  const step4 = await runStep('Step 4: Operator Stop Reason Declaration (POST /api/operator/declare-stop)', async () => {
    const payload = {
      machineId: TEST_MACHINE_ID,
      stopId: `test-stop-${Date.now()}`,
      reasonCode: 'KNT',
      operatorName: 'Pilot Test Operator',
      notes: 'Automated verification test run'
    };

    const res = await fetch(`${BASE_URL}/api/operator/declare-stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.success) throw new Error('Declaration failed');

    // Verify reason in store
    const stateRes = await fetch(`${BASE_URL}/api/live/state`);
    const stateData = await stateRes.json();
    const loom = stateData.looms.find(l => l.machine_id === TEST_MACHINE_ID);
    if (loom?.liveState?.operator_reason !== 'KNT') {
      throw new Error(`Expected operator_reason KNT, got: ${loom?.liveState?.operator_reason}`);
    }
  });
  if (step4) passed++;

  // STEP 5: Configure / Label Auto-Registered Device
  const step5 = await runStep('Step 5: Configure Device Parameters (POST /api/operator/configure-loom)', async () => {
    const configPayload = {
      machineId: TEST_MACHINE_ID,
      loomNumber: 99,
      family: 'OmniPlus-i',
      articleName: 'Pilot Twill Fabric',
      setRpm: 874,
      weftDensity: 27.2
    };

    const res = await fetch(`${BASE_URL}/api/operator/configure-loom`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(configPayload)
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
    const data = await res.json();
    if (!data.success) throw new Error('Configuration failed');

    const stateRes = await fetch(`${BASE_URL}/api/live/state`);
    const stateData = await stateRes.json();
    const loom = stateData.looms.find(l => l.machine_id === TEST_MACHINE_ID);
    if (loom?.loom_number !== 99) throw new Error(`Expected loom_number 99, got: ${loom?.loom_number}`);
  });
  if (step5) passed++;

  // STEP 6: Clean Up Test Artifacts
  const step6 = await runStep('Step 6: Clean Up Test Artifacts (DELETE /api/ingest/v1/batch)', async () => {
    const res = await fetch(`${BASE_URL}/api/ingest/v1/batch?id=${TEST_MAC}`, {
      method: 'DELETE',
      headers: { 'x-weavesync-key': INGEST_KEY }
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const stateRes = await fetch(`${BASE_URL}/api/live/state`);
    const stateData = await stateRes.json();
    const remaining = stateData.looms.find(l => l.machine_id === TEST_MACHINE_ID || l.device_id === TEST_MAC);
    if (remaining) throw new Error('Test machine still present after cleanup');
  });
  if (step6) passed++;

  console.log('\n==============================================================================');
  console.log(`  RESULT: ${passed}/${total} STEPS PASSED`);
  console.log('==============================================================================');

  if (passed === total) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

verifySuite().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
