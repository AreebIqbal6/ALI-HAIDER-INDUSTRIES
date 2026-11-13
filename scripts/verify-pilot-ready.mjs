/**
 * ==============================================================================
 * WEAVESYNC SCADA - 5-STEP PILOT VERIFICATION TEST SUITE
 * Client: Ali Haider Industries (SITE Area, Karachi)
 * Target: Next.js Ingest Bridge & Telemetry Architecture
 * ==============================================================================
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000';

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
  console.log('  WEAVESYNC SCADA - AUTOMATED PILOT VERIFICATION SUITE');
  console.log(`  Target Ingestion URL: ${BASE_URL}`);
  console.log('==============================================================================\n');

  let passed = 0;
  let total = 5;

  // STEP 1: Ingest Health Check (GET)
  const step1 = await runStep('Step 1: Ingestion API Health Check (GET /api/ingest/v1/batch)', async () => {
    const res = await fetch(`${BASE_URL}/api/ingest/v1/batch`);
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    const data = await res.json();
    if (data.status !== 'ONLINE') throw new Error(`Expected status ONLINE, received: ${data.status}`);
    if (data.gatewayId !== 'AHI-GW-01') throw new Error(`Invalid gatewayId: ${data.gatewayId}`);
  });
  if (step1) passed++;

  // STEP 2: Live WT32-ETH01 Raw Frame Ingestion (POST)
  const step2 = await runStep('Step 2: WT32-ETH01 Raw Frame with rawPinHistory (POST /api/ingest/v1/batch)', async () => {
    const payload = {
      machineId: 'PIC-427708',
      gatewayId: 'AHI-GW-01',
      pins: { piStrt: 1, piPp: 1, piWd: 0, piFd: 0, piLd: 0 },
      rpm: 874,
      picksDelta: 14,
      rawPinHistory: [
        { pin: 'PI_PP', level: 1, offsetMsFromStop: -180 },
        { pin: 'PI_STRT', level: 1, offsetMsFromStop: 0 }
      ]
    };

    const res = await fetch(`${BASE_URL}/api/ingest/v1/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(`Payload failed: ${JSON.stringify(data)}`);
    if (data.processed < 1) throw new Error(`Zero records processed: ${JSON.stringify(data)}`);
  });
  if (step2) passed++;

  // STEP 3: Stop Classifier Verification (WARP & FILLING Stops)
  const step3 = await runStep('Step 3: Stop Classifier Hierarchy Verification (FILLING & WARP)', async () => {
    // 3a. Warp Stop (piWd=1, piStrt=0)
    const warpPayload = {
      machineId: 'PIC-427708',
      pins: { piStrt: 0, piPp: 0, piWd: 1, piFd: 0, piLd: 0 },
      rpm: 0
    };
    const warpRes = await fetch(`${BASE_URL}/api/ingest/v1/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(warpPayload)
    });
    if (!warpRes.ok) throw new Error(`Warp stop ingest HTTP ${warpRes.status}`);

    // Verify state reflects WARP
    const stateCheck1 = await fetch(`${BASE_URL}/api/ingest/v1/batch`);
    const data1 = await stateCheck1.json();
    const loomWarp = data1.liveLooms?.['PIC-427708'];
    if (!loomWarp || loomWarp.stop_category !== 'WARP') {
      throw new Error(`Expected WARP stop_category, got: ${loomWarp?.stop_category}`);
    }

    // 3b. Priority: Both piFd=1 and piWd=1 -> FILLING must win
    const fillingPriorityPayload = {
      machineId: 'PIC-427708',
      pins: { piStrt: 0, piPp: 0, piWd: 1, piFd: 1, piLd: 0 },
      rpm: 0
    };
    const fillRes = await fetch(`${BASE_URL}/api/ingest/v1/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(fillingPriorityPayload)
    });
    if (!fillRes.ok) throw new Error(`Filling priority HTTP ${fillRes.status}`);

    const stateCheck2 = await fetch(`${BASE_URL}/api/ingest/v1/batch`);
    const data2 = await stateCheck2.json();
    const loomFill = data2.liveLooms?.['PIC-427708'];
    if (!loomFill || loomFill.stop_category !== 'FILLING') {
      throw new Error(`Expected FILLING priority stop_category, got: ${loomFill?.stop_category}`);
    }
  });
  if (step3) passed++;

  // STEP 4: Restart Loom to RUNNING
  const step4 = await runStep('Step 4: Machine Start Transition Verification (Run Status Active)', async () => {
    const runPayload = {
      machineId: 'PIC-427708',
      pins: { piStrt: 1, piPp: 1, piWd: 0, piFd: 0, piLd: 0 },
      rpm: 874,
      picksDelta: 50
    };
    const res = await fetch(`${BASE_URL}/api/ingest/v1/batch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(runPayload)
    });
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    const data = await (await fetch(`${BASE_URL}/api/ingest/v1/batch`)).json();
    const loom = data.liveLooms?.['PIC-427708'];
    if (loom?.state !== 'RUNNING') throw new Error(`Expected state RUNNING, got: ${loom?.state}`);
  });
  if (step4) passed++;

  // STEP 5: Operator Long-Stop Declaration
  const step5 = await runStep('Step 5: Operator Long-Stop Declaration (POST /api/operator/declare-stop)', async () => {
    const payload = {
      stopId: `stp-test-${Date.now()}`,
      machineId: 'PIC-427708',
      loomNumber: 1,
      startedAt: new Date(Date.now() - 360000).toISOString(),
      durationMs: 360000,
      reasonCode: 'KNT',
      declaredBy: 'Akram Khan (Lead Supervisor)',
      notes: 'Automated test suite verification declaration'
    };

    const res = await fetch(`${BASE_URL}/api/operator/declare-stop`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.ok) throw new Error(`HTTP status ${res.status}`);
    const data = await res.json();
    if (!data.success) throw new Error(`Declaration response failed: ${JSON.stringify(data)}`);
  });
  if (step5) passed++;

  console.log('\n==============================================================================');
  console.log(`  VERIFICATION RESULTS: ${passed}/${total} STEPS PASSED`);
  if (passed === total) {
    console.log('  STATUS: \x1b[32m100% READY FOR FACTORY FLOOR PILOT & CEO DEMO\x1b[0m');
    console.log('==============================================================================\n');
    process.exit(0);
  } else {
    console.log('  STATUS: \x1b[31mSOME CHECKS FAILED - INSPECT LOGS ABOVE\x1b[0m');
    console.log('==============================================================================\n');
    process.exit(1);
  }
}

verifySuite();
