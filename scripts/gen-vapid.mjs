#!/usr/bin/env node
/**
 * Generates a VAPID key pair for Web Push.
 *
 * VAPID is how a push service knows the message came from this application and not from someone who got hold of
 * a subscription endpoint. The pair is generated once per project and then left alone: replacing it invalidates
 * every subscription, so every device has to be re-enabled by hand.
 *
 * Node's own crypto does all of it, so this needs no dependency. The format is the fiddly part: the keys are
 * P-256 points in raw form, base64url-encoded, which is what the Push API and every Web Push library expect —
 * not the PEM or JWK that `generateKeyPairSync` hands back by default.
 *
 *   npm run gen:vapid
 */

import { createECDH } from 'node:crypto';

const base64url = (buffer) => buffer.toString('base64url');

const curve = createECDH('prime256v1');
curve.generateKeys();

// The public key is the uncompressed point: 0x04 followed by X and Y, 65 bytes.
const publicKey = base64url(curve.getPublicKey());
// The private key is the scalar, 32 bytes. Left-padded, because a leading zero byte is dropped otherwise and a
// 31-byte key is rejected with an error that says nothing about padding.
const privateKey = base64url(curve.getPrivateKey('buffer').subarray(-32));

console.log(`
VAPID keys generated. The public key is safe to publish; the private key is not.

  Public   ${publicKey}
  Private  ${privateKey}

Where each one goes:

  1. The web app needs the public key at build time, as a repository variable:

       gh variable set VITE_VAPID_PUBLIC_KEY --body '${publicKey}'

     or paste it into packages/web/.env.local for local development:

       VITE_VAPID_PUBLIC_KEY=${publicKey}

  2. The Edge Functions need both, plus a contact address, as function secrets:

       npx supabase secrets set \\
         VAPID_PUBLIC_KEY='${publicKey}' \\
         VAPID_PRIVATE_KEY='${privateKey}' \\
         VAPID_SUBJECT='mailto:you@example.com'

The private key must never reach the browser or the repository. Requirement 7.9.
`);
