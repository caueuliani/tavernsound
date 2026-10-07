import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compatibleAgoraSdp } from '../apps/web/app/lib/agora-compat.ts';
test('removes only the incompatible optional ICE optimization', () => {
  const sdp = 'v=0\r\na=ice-options:trickle goog-sped-v1\r\na=ice-ufrag:unchanged\r\na=fingerprint:sha-256 unchanged\r\n';
  assert.equal(compatibleAgoraSdp(sdp), sdp.replace('trickle goog-sped-v1', 'trickle'));
  assert.equal(compatibleAgoraSdp('a=ice-options:trickle\r\n'), 'a=ice-options:trickle\r\n');
});
