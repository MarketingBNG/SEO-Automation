// "Check a blog" by URL must not reach the server's own network (no DNS or network needed here).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPrivateAddress, assertPublicUrl } from '../lib/safeFetch';

test('private, loopback, link-local and metadata addresses are private', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '104.16.1.1', '192.0.78.9', '2606:4700::1111']) assert.equal(isPrivateAddress(ip), false, ip);
});

test('only public http(s) URLs are accepted', async () => {
  for (const u of ['http://169.254.169.254/latest/meta-data/', 'http://localhost:3000/', 'http://coolify:8080/', 'file:///etc/passwd', 'http://[::1]/', 'http://127.0.0.1/', 'not a url']) {
    await assert.rejects(assertPublicUrl(u), (e: any) => e.status === 400, u);
  }
  assert.equal((await assertPublicUrl('https://8.8.8.8/page')).hostname, '8.8.8.8');
});
