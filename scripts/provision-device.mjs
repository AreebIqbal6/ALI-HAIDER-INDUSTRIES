#!/usr/bin/env node
/**
 * Provision (or re-provision = rotate token for) a loom logger.
 *
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
 *   node scripts/provision-device.mjs --device e0e2e6aabbcc --machine PIC-427708 [--loom-number 1]
 *
 * - Generates a random device token, stores ONLY its SHA-256 in `devices.token_hash`
 *   (via RPC provision_device from migration 006), upserting the loom row.
 * - Prints the token ONCE. Put it into the logger config; it cannot be recovered later.
 */
import { createHash, randomBytes } from 'crypto';
import { createClient } from '@supabase/supabase-js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key] = true;
    else { out[key] = next; i++; }
  }
  return out;
}

function usage(msg) {
  if (msg) console.error(`Error: ${msg}\n`);
  console.error('Usage: node scripts/provision-device.mjs --device <mac/deviceId> --machine PIC-<serial> [--loom-number <n>]');
  console.error('Env:   NEXT_PUBLIC_SUPABASE_URL (or SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));
if (args.help || args.h) usage();

const deviceId = typeof args.device === 'string' ? args.device.trim().toLowerCase().replace(/[:-]/g, '') : '';
const machineId = typeof args.machine === 'string' ? args.machine.trim() : '';
const loomNumber = args['loom-number'] !== undefined ? Number(args['loom-number']) : null;

if (!deviceId || !/^[0-9a-z]{1,64}$/.test(deviceId)) usage('--device is required (MAC, e.g. e0e2e6aabbcc)');
if (!/^PIC-[A-Za-z0-9]{1,32}$/.test(machineId)) usage('--machine must look like PIC-<serial>');
if (loomNumber !== null && (!Number.isInteger(loomNumber) || loomNumber < 1)) usage('--loom-number must be an integer >= 1');

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) usage('SUPABASE URL and SUPABASE_SERVICE_ROLE_KEY must be set in the environment');

const token = randomBytes(32).toString('base64url'); // 43 chars, 256 bits
const tokenHash = createHash('sha256').update(token, 'utf8').digest('hex');

const supabase = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
const { error } = await supabase.rpc('provision_device', {
  p_device_id: deviceId,
  p_machine_id: machineId,
  p_token_hash: tokenHash,
  p_loom_number: loomNumber,
});
if (error) {
  console.error(`Provisioning failed: ${error.message}`);
  console.error('Has supabase/migrations/006_contract_v1.sql been applied?');
  process.exit(2);
}

console.log(`Provisioned device ${deviceId} -> ${machineId}${loomNumber ? ` (loom #${loomNumber})` : ''}.`);
console.log('Device token (shown once; store it in the logger, do not commit it):');
console.log(token);
