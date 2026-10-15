// Camera relay: validation, SSRF protection, content checks, size cap, caching, stale-on-error, auth.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tmp = mkdtempSync(join(tmpdir(), 'vv4-'));
Object.assign(process.env, { CAMERAS_FILE: `${tmp}/cameras.json`, STORE_DIR: `${tmp}/store/`, SETTINGS_FILE: `${tmp}/s.json`, POLICY_FILE: `${tmp}/p.json`, TOURS_FILE: `${tmp}/t.json` });
delete process.env.DASHBOARD_PASSWORD; delete process.env.ADMIN_PASSWORD; delete process.env.CAMERAS_ALLOW_PRIVATE;
writeFileSync(process.env.TOURS_FILE, JSON.stringify({ demo: false, tours: [] }));

const { setFetch } = await import('../server/lib/http.js');
const cams = await import('../server/services/cameras.js');
const { createServer } = await import('../server/index.js');

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9]);
const reply = (body, { status = 200, type = 'image/jpeg', headers = {} } = {}) => ({ ok: status >= 200 && status < 300, status, headers: { get: k => ({ 'content-type': type, ...headers })[k.toLowerCase()] ?? null }, arrayBuffer: async () => body.buffer.slice(body.byteOffset, body.byteOffset + body.length) });
const own = (o = {}) => ({ id: 'site-glacier', name: 'Glacier car park', type: 'image', source: 'own', own: true, url: 'https://cam.arctic.example/latest.jpg', refreshSec: 30, tours: [2], ...o });
cams.resolver.lookup = async host => [{ address: host.startsWith('internal') ? '10.1.2.3' : host === 'rebind.example' ? '127.0.0.1' : '93.184.216.34' }];

test('validation: ids, types, third-party permission, credentials never in the URL', () => {
  assert.deepEqual(cams.validateCamera(own()), []);
  assert.ok(cams.validateCamera(own({ id: 'Bad Id' })).some(x => /id must be/.test(x)));
  assert.ok(cams.validateCamera(own({ type: 'rtsp' })).some(x => /type must be/.test(x)));
  assert.ok(cams.validateCamera(own({ url: 'rtsp://cam/stream' })).some(x => /http\(s\)/.test(x)));
  assert.ok(cams.validateCamera(own({ url: 'https://user:pw@cam.example/a.jpg' })).some(x => /credentials/.test(x)));
  assert.ok(cams.validateCamera(own({ own: false })).some(x => /permission/.test(x)), 'third-party image needs a recorded permission');
  assert.deepEqual(cams.validateCamera(own({ own: false, permission: 'Written OK from owner, 2026-10-01' })), []);
  assert.deepEqual(cams.validateCamera({ id: 'x-page', name: 'Page', type: 'page', url: 'https://example.is/cams' }), []);   // link-out needs no permission
  assert.ok(cams.validateCamera(own({ authEnv: 'lowercase' })).some(x => /authEnv/.test(x)));
  assert.ok(cams.validateCamera(own({ refreshSec: 2 })).some(x => /refreshSec/.test(x)));
});

test('SSRF: private, loopback, link-local and metadata addresses are refused; public hosts pass', async () => {
  for (const ip of ['10.0.0.1', '127.0.0.1', '169.254.169.254', '172.20.1.1', '192.168.1.5', '100.64.0.1', '::1', 'fd00::1', 'fe80::1', '::ffff:10.1.1.1', '0.0.0.0']) assert.equal(cams.isPrivateAddress(ip), true, ip);
  for (const ip of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) assert.equal(cams.isPrivateAddress(ip), false, ip);
  await assert.rejects(() => cams.assertAllowedUrl('http://169.254.169.254/latest/meta-data/'), /private/);
  await assert.rejects(() => cams.assertAllowedUrl('http://localhost:8080/api/admin/keys'.replace('localhost', '127.0.0.1')), /private/);
  await assert.rejects(() => cams.assertAllowedUrl('https://internal-cam.example/a.jpg'), /private/);      // hostname that resolves to 10.x
  await assert.rejects(() => cams.assertAllowedUrl('https://rebind.example/a.jpg', { own: true }), /private/); // "own" still needs the env switch
  await assert.rejects(() => cams.assertAllowedUrl('file:///etc/passwd'), /http or https/);
  assert.ok(await cams.assertAllowedUrl('https://cam.arctic.example/latest.jpg'));
  process.env.CAMERAS_ALLOW_PRIVATE = '1';
  assert.ok(await cams.assertAllowedUrl('http://10.8.0.5:1984/api/frame.jpeg?src=glacier', { own: true }));  // on-site camera over a VPN
  await assert.rejects(() => cams.assertAllowedUrl('http://10.8.0.5/a.jpg', { own: false }), /private/);     // but never for third-party entries
  delete process.env.CAMERAS_ALLOW_PRIVATE;
});

test('snapshot relay: serves images, caches within refresh time, sends auth from env, rejects non-images/SVG/oversize', async () => {
  assert.equal(cams.saveCameras([own({ authEnv: 'CAM_TEST_AUTH' }), own({ id: 'bad-type', url: 'https://cam.arctic.example/page.html' }), own({ id: 'svg', url: 'https://cam.arctic.example/x.svg' }), own({ id: 'huge', url: 'https://cam.arctic.example/huge.jpg' }), own({ id: 'down', url: 'https://cam.arctic.example/down.jpg' })]).ok, true);
  process.env.CAM_TEST_AUTH = 'Basic dXNlcjpwdw==';
  let calls = 0, seen;
  setFetch(async (u, o) => {
    calls++; seen = { u: String(u), o };
    if (u.includes('page.html')) return reply(Buffer.from('<html>'), { type: 'text/html' });
    if (u.includes('x.svg')) return reply(Buffer.from('<svg onload=alert(1)>'), { type: 'image/svg+xml' });
    if (u.includes('huge')) return reply(Buffer.alloc(5 * 1024 * 1024));
    if (u.includes('down')) return reply(Buffer.alloc(0), { status: 503 });
    return reply(JPEG, { headers: { 'last-modified': 'Wed, 14 Oct 2026 10:00:00 GMT' } });
  });
  const a = await cams.snapshot('site-glacier', { now: 1_000_000 });
  assert.deepEqual([...a.buf], [...JPEG]); assert.equal(a.type, 'image/jpeg'); assert.equal(a.stale, false);
  assert.equal(seen.o.headers.Authorization, 'Basic dXNlcjpwdw==');              // credentials come from the environment, not the config
  assert.equal(seen.o.redirect, 'manual');
  await cams.snapshot('site-glacier', { now: 1_010_000 }); assert.equal(calls, 1, 'second request within refreshSec uses the cached frame');
  await cams.snapshot('site-glacier', { now: 1_040_000 }); assert.equal(calls, 2, 'refetched after refreshSec');
  await assert.rejects(() => cams.snapshot('bad-type'), /not a supported image/);
  await assert.rejects(() => cams.snapshot('svg'), /not a supported image/);     // SVG can carry script
  await assert.rejects(() => cams.snapshot('huge'), /too large/);
  assert.equal(await cams.snapshot('nope'), null);
  // stale-on-error: a good frame is kept for a while when the camera drops, then it errors
  setFetch(async () => reply(Buffer.alloc(0), { status: 503 }));
  const s = await cams.snapshot('site-glacier', { now: 1_100_000 }); assert.equal(s.stale, true); assert.match(s.error, /503/);
  await assert.rejects(() => cams.snapshot('site-glacier', { now: 1_040_000 + 16 * 60e3 }), /503/);
  delete process.env.CAM_TEST_AUTH;
});

test('redirects are followed manually and each hop is re-checked', async () => {
  cams.saveCameras([own()]);
  setFetch(async u => String(u).includes('/latest.jpg')
    ? reply(Buffer.alloc(0), { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data/' } })
    : reply(JPEG));
  await assert.rejects(() => cams.snapshot('site-glacier', { fresh: true }), /private/);       // redirect into the internal network is blocked
  setFetch(async u => String(u).includes('/latest.jpg') ? reply(Buffer.alloc(0), { status: 301, headers: { location: 'https://cdn.arctic.example/frame.jpg' } }) : reply(JPEG));
  assert.equal((await cams.snapshot('site-glacier', { fresh: true })).buf.length, JPEG.length);
});

test('public list never exposes image URLs or credentials; page cameras expose their link', () => {
  cams.saveCameras([own({ authEnv: 'CAM_X' }), { id: 'road-cams', name: 'Road cams', type: 'page', source: 'vegagerdin', global: true, url: 'https://umferdin.is/' }]);
  const list = cams.publicList(), img = list.find(c => c.id === 'site-glacier'), page = list.find(c => c.id === 'road-cams');
  assert.equal(img.url, undefined); assert.equal(JSON.stringify(img).includes('cam.arctic.example'), false); assert.equal(JSON.stringify(img).includes('CAM_X'), false);
  assert.equal(page.url, 'https://umferdin.is/');
});

test('HTTP: snapshots need the dashboard login; fresh pulls and camera management are admin only; admin can test', async () => {
  cams.saveCameras([own(), { id: 'road-cams', name: 'Road cams', type: 'page', source: 'vegagerdin', global: true, url: 'https://umferdin.is/' }]);
  setFetch(async () => reply(JPEG));
  Object.assign(process.env, { DASHBOARD_PASSWORD: 'dash', ADMIN_PASSWORD: 'adm' });
  const srv = createServer(); await new Promise(r => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`, b = (u, p) => ({ Authorization: 'Basic ' + Buffer.from(`${u}:${p}`).toString('base64') }), J = { 'content-type': 'application/json' };
  try {
    assert.equal((await fetch(`${base}/api/cameras/site-glacier/snapshot`)).status, 401);
    const ok = await fetch(`${base}/api/cameras/site-glacier/snapshot`, { headers: b('arctic', 'dash') });
    assert.equal(ok.status, 200); assert.equal(ok.headers.get('content-type'), 'image/jpeg'); assert.ok(ok.headers.get('x-snapshot-at')); assert.equal(ok.headers.get('x-snapshot-stale'), '0');
    assert.equal((await fetch(`${base}/api/cameras/nope/snapshot`, { headers: b('arctic', 'dash') })).status, 404);
    assert.equal((await fetch(`${base}/api/cameras/road-cams/snapshot`, { headers: b('arctic', 'dash') })).status, 404);   // page cameras are never fetched
    assert.equal((await fetch(`${base}/api/admin/cameras`, { headers: b('arctic', 'dash') })).status, 401);
    const list = await (await fetch(`${base}/api/admin/cameras`, { headers: b('admin', 'adm') })).json(); assert.equal(list.length, 2);
    const bad = await fetch(`${base}/api/admin/cameras`, { method: 'POST', headers: { ...b('admin', 'adm'), ...J }, body: JSON.stringify({ id: 'x', name: 'x', type: 'image', url: 'http://x' }) });
    assert.equal(bad.status, 422);
    const add = await fetch(`${base}/api/admin/cameras`, { method: 'POST', headers: { ...b('admin', 'adm'), ...J }, body: JSON.stringify(own({ id: 'second-cam' })) }); assert.equal(add.status, 200);
    const t = await (await fetch(`${base}/api/admin/cameras/second-cam/test`, { method: 'POST', headers: { ...b('admin', 'adm'), ...J }, body: '{}' })).json();
    assert.equal(t.ok, true); assert.equal(t.bytes, JPEG.length);
    setFetch(async () => reply(Buffer.alloc(0), { status: 500 }));
    const t2 = await (await fetch(`${base}/api/admin/cameras/second-cam/test`, { method: 'POST', headers: { ...b('admin', 'adm'), ...J }, body: '{}' })).json();
    assert.equal(t2.ok, false); assert.match(t2.error, /500/);
    assert.equal((await fetch(`${base}/api/admin/cameras/second-cam`, { method: 'DELETE', headers: b('admin', 'adm') })).status, 200);
  } finally { srv.close(); delete process.env.DASHBOARD_PASSWORD; delete process.env.ADMIN_PASSWORD; }
});
