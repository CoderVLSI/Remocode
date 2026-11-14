#!/usr/bin/env node
// One-time auth setup for your Convex deployment:  node scripts/convex-setup.mjs
//
// Convex Auth signs session tokens with a private key that lives only on the deployment. This script
// makes a fresh key pair and stores both halves as deployment environment variables
// (JWT_PRIVATE_KEY, JWKS) using the Convex CLI, so you must be logged in (`npx convex dev` does that).
//
//   --print   only print the values instead of setting them
//   --prod    set them on your production deployment instead of the dev one
import { spawnSync } from 'node:child_process';

import { exportJWK, exportPKCS8, generateKeyPair } from 'jose';

const print = process.argv.includes('--print');
const prod = process.argv.includes('--prod');

const { publicKey, privateKey } = await generateKeyPair('RS256', { extractable: true });
const pem = (await exportPKCS8(privateKey)).trimEnd().replace(/\n/g, ' ');
const jwks = JSON.stringify({ keys: [{ use: 'sig', ...(await exportJWK(publicKey)) }] });

if (print) {
  console.log(`JWT_PRIVATE_KEY="${pem}"\n`);
  console.log(`JWKS=${jwks}`);
  process.exit(0);
}

function set(name, value) {
  const args = ['convex', 'env', 'set', ...(prod ? ['--prod'] : []), name, '--', value];
  const result = spawnSync('npx', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  if (result.status !== 0) {
    console.error(`\nCould not set ${name}. Make sure you ran \`npx convex dev\` once (it logs you in and links this folder to a deployment).`);
    process.exit(result.status ?? 1);
  }
}

set('JWT_PRIVATE_KEY', pem);
set('JWKS', jwks);
console.log('\nAuth keys are set. Password sign-in now works.');
console.log('Optional: for emailed sign-in codes run  npx convex env set AUTH_RESEND_KEY <your Resend API key>');
