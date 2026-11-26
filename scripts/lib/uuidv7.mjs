// RFC 9562 UUIDv7 (mirror of src/lib/contract/uuid.ts for plain-node scripts).
import { randomBytes } from 'crypto';

let lastMs = -1;
let counter = 0;

export function generateUuidV7(nowMs = Date.now()) {
  const b = randomBytes(16);
  let ms = Math.max(0, Math.floor(nowMs));
  if (ms <= lastMs) {
    counter++;
    if (counter > 0xfff) { lastMs++; counter = 0; }
    ms = lastMs;
  } else {
    lastMs = ms;
    counter = b[6] & 0x07;
  }
  b[0] = Math.floor(ms / 2 ** 40) & 0xff;
  b[1] = Math.floor(ms / 2 ** 32) & 0xff;
  b[2] = (ms >>> 24) & 0xff;
  b[3] = (ms >>> 16) & 0xff;
  b[4] = (ms >>> 8) & 0xff;
  b[5] = ms & 0xff;
  b[6] = 0x70 | ((counter >>> 8) & 0x0f);
  b[7] = counter & 0xff;
  b[8] = 0x80 | (b[8] & 0x3f);
  const h = b.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
