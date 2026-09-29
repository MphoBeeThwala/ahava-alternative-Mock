/**
 * Split-custody escrow copy of the data-encryption key
 * (docs/SECURITY_RUNBOOK.md §1 step 6).
 *
 * The key is split into two shares with XOR: share 1 is 32 random bytes,
 * share 2 is key XOR share 1. Either share alone is indistinguishable from
 * random and reveals nothing about the key; both together rebuild it
 * exactly. Each share goes to a different custodian's vault, so recovering
 * the key always takes two people.
 *
 *   ENCRYPTION_KEY='<key>' pnpm --filter backend key-escrow split
 *   ESCROW_SHARE_1='...' ESCROW_SHARE_2='...' pnpm --filter backend key-escrow combine
 *
 * The fingerprint (first 16 hex of SHA-256 of the key) lets custodians
 * confirm a rebuilt key is the right one without anyone writing it down.
 */
import crypto from 'crypto';

const SHARE_PREFIX = 'ahava-key-share-v1:';

export function keyFingerprint(key: Buffer): string {
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function splitKey(keyB64: string): { share1: string; share2: string; fingerprint: string } {
  const key = Buffer.from(keyB64, 'base64');
  if (key.length !== 32) throw new Error(`Key is ${key.length} bytes; expected a 32-byte base64 key`);
  const a = crypto.randomBytes(32);
  const b = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) b[i] = key[i] ^ a[i];
  const fingerprint = keyFingerprint(key);
  key.fill(0);
  return {
    share1: `${SHARE_PREFIX}1:${a.toString('base64')}`,
    share2: `${SHARE_PREFIX}2:${b.toString('base64')}`,
    fingerprint,
  };
}

function parseShare(share: string, expected: '1' | '2'): Buffer {
  const trimmed = share.trim();
  if (!trimmed.startsWith(SHARE_PREFIX)) throw new Error(`Share ${expected} is not an Ahava key share`);
  const [n, b64] = trimmed.slice(SHARE_PREFIX.length).split(':');
  if (n !== expected) throw new Error(`Expected share ${expected}, got share ${n}`);
  const buf = Buffer.from(b64 ?? '', 'base64');
  if (buf.length !== 32) throw new Error(`Share ${expected} is damaged (wrong length)`);
  return buf;
}

export function combineShares(share1: string, share2: string): { keyB64: string; fingerprint: string } {
  const a = parseShare(share1, '1');
  const b = parseShare(share2, '2');
  const key = Buffer.alloc(32);
  for (let i = 0; i < 32; i++) key[i] = a[i] ^ b[i];
  const out = { keyB64: key.toString('base64'), fingerprint: keyFingerprint(key) };
  key.fill(0);
  return out;
}

function main() {
  const command = process.argv[2];
  if (command === 'split') {
    const key = process.env.ENCRYPTION_KEY;
    if (!key) throw new Error('Set ENCRYPTION_KEY to the key to escrow.');
    const { share1, share2, fingerprint } = splitKey(key);
    console.log(`Key fingerprint: ${fingerprint}   (record this with both shares)\n`);
    console.log('CUSTODIAN 1 — store only in custodian 1’s vault:');
    console.log(`  ${share1}\n`);
    console.log('CUSTODIAN 2 — store only in custodian 2’s vault:');
    console.log(`  ${share2}\n`);
    console.log('Then clear this terminal (e.g. `clear && history -c`).');
  } else if (command === 'combine') {
    const s1 = process.env.ESCROW_SHARE_1;
    const s2 = process.env.ESCROW_SHARE_2;
    if (!s1 || !s2) throw new Error('Set ESCROW_SHARE_1 and ESCROW_SHARE_2.');
    const { keyB64, fingerprint } = combineShares(s1, s2);
    console.log(`Key fingerprint: ${fingerprint}   (must match the recorded fingerprint)`);
    console.log(`ENCRYPTION_KEY=${keyB64}`);
  } else {
    throw new Error('Usage: key-escrow split | combine');
  }
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}
