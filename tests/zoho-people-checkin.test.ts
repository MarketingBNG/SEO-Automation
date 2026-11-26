import test from 'node:test';
import assert from 'node:assert/strict';

process.env.DATABASE_URL ||= 'postgresql://unused@localhost/unused';
/* eslint-disable @typescript-eslint/no-require-imports */
const zp = require('../lib/zohoPeople') as typeof import('../lib/zohoPeople');

test('check-in value has date AND time matching dd-MM-yyyy HH:mm:ss', () => {
  // 2026-11-25 05:06:07 UTC = 10:36:07 IST, same IST day -> the actual time.
  const now = new Date('2026-11-25T05:06:07Z');
  assert.equal(zp.checkInValue('2026-11-25', now), '25-11-2026 10:36:07');
  assert.match(zp.checkInValue('2026-11-25', now), /^\d{2}-\d{2}-\d{4} \d{2}:\d{2}:\d{2}$/);
  // A different day (back-dated) falls back to 09:00.
  assert.equal(zp.checkInValue('2026-11-20', now), '20-11-2026 09:00:00');
});

test('Zoho failure shapes are detected, success is not', () => {
  assert.equal(zp.zohoFailed({ error: 'x' }), true);
  assert.equal(zp.zohoFailed({ errors: { code: 7024 } }), true);
  assert.equal(zp.zohoFailed({ response: { status: 1, errors: { message: 'Invalid date format' } } }), true);
  assert.equal(zp.zohoFailed(null), true);
  assert.equal(zp.zohoFailed({ response: { status: 0, result: [{ punchIn: '25-11-2026 10:36:07' }] } }), false);
  assert.equal(zp.zohoFailed([{ response: 'success' }]), false);
});

test('Zoho accounts server: only real Zoho data centres are accepted (no secret sent elsewhere)', async () => {
  const { isZohoAccounts } = await import('../lib/zohoPeople');
  for (const ok of ['https://accounts.zoho.com', 'https://accounts.zoho.in/', 'https://accounts.zoho.eu', 'https://accounts.zoho.com.au']) assert.equal(isZohoAccounts(ok), true, ok);
  for (const bad of ['https://accounts.zoho.attacker.com', 'https://accounts.zoho.com.evil.io', 'http://accounts.zoho.com', 'https://accounts.zoho.com:8443', 'https://accounts.zoho.com/x', 'https://evil.com/?https://accounts.zoho.com']) assert.equal(isZohoAccounts(bad), false, bad);
});
