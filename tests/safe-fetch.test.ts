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

test('IPv4-compatible IPv6 forms of internal addresses are private', () => {
  // new URL('http://[::127.0.0.1]/').hostname is [::7f00:1]
  for (const ip of ['::7f00:1', '::a9fe:a9fe', '::127.0.0.1']) assert.equal(isPrivateAddress(ip), true, ip);
});

test('the connection itself refuses a name that resolves to an internal address (DNS rebinding)', async () => {
  const { pinnedLookup } = await import('../lib/safeFetch');
  for (const opts of [{}, { all: true }]) {
    const err: any = await new Promise((resolve) => pinnedLookup('localhost', opts, (e: any) => resolve(e)));
    assert.ok(err && err.status === 400 && /private or internal/.test(err.message), JSON.stringify(opts));
  }
});

test('getOnce returns status, headers and the unzipped body, and does not follow redirects', async () => {
  const http = await import('node:http');
  const zlib = await import('node:zlib');
  const { getOnce } = await import('../lib/safeFetch');
  const server = http.createServer((req, res) => {
    if (req.url === '/moved') {
      res.writeHead(301, { location: '/page' });
      return res.end();
    }
    res.writeHead(200, { 'content-type': 'text/html', 'content-encoding': 'gzip' });
    res.end(zlib.gzipSync('<h1>Hello</h1>'));
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  try {
    const port = (server.address() as any).port;
    const signal = AbortSignal.timeout(5000);
    const moved = await getOnce(new URL(`http://127.0.0.1:${port}/moved`), signal);
    assert.equal(moved.status, 301);
    assert.equal(moved.headers.get('location'), '/page');
    await moved.body?.cancel();
    const page = await getOnce(new URL(`http://127.0.0.1:${port}/page`), signal);
    assert.equal(page.status, 200);
    assert.equal(await page.text(), '<h1>Hello</h1>');
  } finally {
    server.close();
  }
});
