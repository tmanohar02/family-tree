#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const repoRoot = '/home/tmanohar02/Projects/FamilyTree';
const outPath = path.join(repoRoot, 'family-chart/examples/api-token.enc.json');

const token = process.argv[2];
const passphrase = process.argv[3] || 'ramana73';

if (!token) {
  console.error('Usage: node scripts/encrypt-worker-api-token.mjs <api_token> [passphrase]');
  process.exit(1);
}

const enc = new TextEncoder();
const salt = crypto.randomBytes(16);
const iv = crypto.randomBytes(12);
const iterations = 150000;

const keyMaterial = await crypto.webcrypto.subtle.importKey(
  'raw',
  enc.encode(passphrase),
  { name: 'PBKDF2' },
  false,
  ['deriveKey']
);

const key = await crypto.webcrypto.subtle.deriveKey(
  {
    name: 'PBKDF2',
    salt,
    iterations,
    hash: 'SHA-256'
  },
  keyMaterial,
  { name: 'AES-GCM', length: 256 },
  false,
  ['encrypt']
);

const ciphertext = await crypto.webcrypto.subtle.encrypt(
  { name: 'AES-GCM', iv },
  key,
  enc.encode(token)
);

const payload = {
  kdf: {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations,
    salt: salt.toString('base64')
  },
  cipher: {
    name: 'AES-GCM',
    iv: iv.toString('base64')
  },
  data: Buffer.from(ciphertext).toString('base64')
};

fs.writeFileSync(outPath, JSON.stringify(payload, null, 2), 'utf8');
console.log(`Wrote ${outPath}`);
