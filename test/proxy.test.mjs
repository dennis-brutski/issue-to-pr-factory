import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, connect } from 'node:net';
import { existsSync } from 'node:fs';
import { proxyServer, startProxy, isPrivate } from '../lib/proxy.mjs';
import { tempDir } from './fakes/tmp.mjs';
import { run } from '../lib/exec.mjs';
import { BRIDGE } from '../lib/confine.mjs';

// A fake resolver: names map to addresses; an unknown name does not resolve.
const NAMES = { 'registry.npmjs.org': ['104.16.0.35'], 'local.test': ['127.0.0.1'], 'lan.test': ['93.184.216.34', '10.0.0.5'], 'x.com': ['104.244.42.1'] };
const lookup = async (host) => { if (!NAMES[host]) throw new Error('ENOTFOUND'); return NAMES[host].map((address) => ({ address, family: 4 })); };

// The proxy on a TCP port of 127.0.0.1: the factory listens on a Unix socket, which some sandboxes forbid.
async function listening(opts) {
  const proxy = proxyServer(opts);
  await new Promise((r) => proxy.server.listen(0, '127.0.0.1', () => r(undefined)));
  return { ...proxy, port: /** @type {import('node:net').AddressInfo} */ (proxy.server.address()).port };
}

// Sends one raw request to the proxy (a TCP port or a socket path); resolves with the first reply chunk and the socket.
// Rejects when the socket closes without a reply, or when the test's signal ends it at its time limit.
function ask(signal, to, request) {
  return new Promise((resolve, reject) => {
    const s = typeof to === 'string' ? connect(to, () => s.write(request)) : connect(to, '127.0.0.1', () => s.write(request));
    const stop = () => { s.destroy(); reject(signal.reason); };
    signal.addEventListener('abort', stop, { once: true });
    s.once('data', (d) => { signal.removeEventListener('abort', stop); resolve({ reply: String(d), s }); });
    s.once('error', reject);
    s.once('close', () => reject(new Error('closed without a reply')));
  });
}

// Waits for the next chunk on a socket; rejects when it closes first or the test's signal ends it.
function next(signal, s) {
  return new Promise((resolve, reject) => {
    const stop = () => { s.destroy(); reject(signal.reason); };
    signal.addEventListener('abort', stop, { once: true });
    s.once('data', (d) => { signal.removeEventListener('abort', stop); resolve(String(d)); });
    s.once('close', () => reject(new Error('closed before the next chunk')));
  });
}

// An "upstream" on 127.0.0.1 that echoes, standing in for the real host: the proxy's connect is faked
// so that a public address reaches it, and the test needs no network.
async function echo() {
  const server = createServer((c) => c.pipe(c));
  await new Promise((r) => server.listen(0, '127.0.0.1', () => r(undefined)));
  const port = /** @type {import('node:net').AddressInfo} */ (server.address()).port;
  return { server, dialed: [], fakeConnect(p, address) { this.dialed.push([address, p]); return connect(port, '127.0.0.1'); } };
}

// A test that waits on a socket fails after 5 seconds instead of hanging when the proxy misbehaves:
// its signal ends the wait, so the test's finally closes the proxy.
const LIMIT = 5000;

test('a listed host on 443 is tunnelled to its resolved address', { timeout: LIMIT }, async (t) => {
  const up = await echo();
  const proxy = await listening({ hosts: ['registry.npmjs.org'], lookup, connect: up.fakeConnect.bind(up) });
  try {
    const { reply, s } = await ask(t.signal, proxy.port, 'CONNECT registry.npmjs.org:443 HTTP/1.1\r\nHost: registry.npmjs.org:443\r\n\r\n');
    assert.match(reply, /^HTTP\/1.1 200/);
    s.write('ping');
    const back = await next(t.signal, s);
    assert.equal(back, 'ping');
    s.destroy();
    assert.deepEqual(up.dialed, [['104.16.0.35', 443]]);
    assert.deepEqual(proxy.refused(), []);
    assert.equal(proxy.requests(), 1);
  } finally { await proxy.close(); up.server.close(); }
});

test('an unlisted host, another port and plain HTTP are refused and recorded', { timeout: LIMIT }, async (t) => {
  const up = await echo();
  const proxy = await listening({ hosts: ['registry.npmjs.org'], lookup, connect: up.fakeConnect.bind(up) });
  try {
    for (const req of ['CONNECT x.com:443 HTTP/1.1\r\nHost: x.com:443\r\n\r\n', 'CONNECT registry.npmjs.org:22 HTTP/1.1\r\n\r\n',
      'GET http://plain.test/ HTTP/1.1\r\nHost: plain.test\r\n\r\n']) {
      const { reply, s } = await ask(t.signal, proxy.port, req);
      assert.match(reply, /^HTTP\/1.1 403/, req);
      s.destroy();
    }
    assert.deepEqual(up.dialed, [], 'nothing was dialed');
    assert.deepEqual(proxy.refused(), [{ host: 'x.com', why: 'unlisted' }, { host: 'registry.npmjs.org:22', why: 'port' }, { host: 'plain.test', why: 'plain' }]);
    assert.equal(proxy.requests(), 3);
  } finally { await proxy.close(); up.server.close(); }
});

test('a listed host that resolves to loopback or a private address is refused and recorded', { timeout: LIMIT }, async (t) => {
  const up = await echo();
  const proxy = await listening({ hosts: ['local.test', 'lan.test'], lookup, connect: up.fakeConnect.bind(up) });
  try {
    for (const host of ['local.test', 'lan.test']) {
      const { reply, s } = await ask(t.signal, proxy.port, `CONNECT ${host}:443 HTTP/1.1\r\n\r\n`);
      assert.match(reply, /^HTTP\/1.1 403/, host);
      s.destroy();
    }
    assert.deepEqual(up.dialed, []);
    assert.deepEqual(proxy.refused(), [{ host: 'local.test', why: 'private' }, { host: 'lan.test', why: 'private' }]);
  } finally { await proxy.close(); up.server.close(); }
});

test('host names match without regard to case, and a refused host is recorded once', { timeout: LIMIT }, async (t) => {
  const up = await echo();
  const proxy = await listening({ hosts: ['Registry.npmjs.org'], lookup, connect: up.fakeConnect.bind(up) });
  try {
    const ok = await ask(t.signal, proxy.port, 'CONNECT REGISTRY.NPMJS.ORG:443 HTTP/1.1\r\n\r\n');
    assert.match(ok.reply, /^HTTP\/1.1 200/);
    ok.s.destroy();
    for (let i = 0; i < 2; i++) (await ask(t.signal, proxy.port, 'CONNECT x.com:443 HTTP/1.1\r\n\r\n')).s.destroy();
    assert.deepEqual(proxy.refused(), [{ host: 'x.com', why: 'unlisted' }]);
  } finally { await proxy.close(); up.server.close(); }
});

test('a listed host that does not resolve gets a 502 and is not recorded as refused', { timeout: LIMIT }, async (t) => {
  const proxy = await listening({ hosts: ['gone.test'], lookup });
  try {
    const { reply, s } = await ask(t.signal, proxy.port, 'CONNECT gone.test:443 HTTP/1.1\r\n\r\n');
    assert.match(reply, /^HTTP\/1.1 502/);
    s.destroy();
    assert.deepEqual(proxy.refused(), []);
  } finally { await proxy.close(); }
});

const unix = await new Promise((r) => { const s = createServer().once('error', () => r(false)); s.listen(`${tempDir('sock-')}/probe.sock`, () => s.close(() => r(true))); });
test('startProxy listens on proxy.sock in its folder, and close removes it', { timeout: LIMIT, skip: unix ? false : 'this sandbox forbids Unix sockets' }, async (t) => {
  const proxy = await startProxy({ dir: tempDir('proxy-'), hosts: [] });
  assert.ok(existsSync(proxy.socket));
  const { reply, s } = await ask(t.signal, proxy.socket, 'CONNECT x.com:443 HTTP/1.1\r\n\r\n');
  assert.match(reply, /^HTTP\/1.1 403/);
  s.destroy();
  await proxy.close();
  assert.ok(!existsSync(proxy.socket));
});

test('isPrivate knows loopback, private, link-local and the unspecified address', () => {
  for (const a of ['127.0.0.1', '127.8.8.8', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1',
    '::1', '::', 'fe80::1', 'fc00::1', 'fd12::3', '::ffff:127.0.0.1', '::ffff:10.0.0.1'])
    assert.equal(isPrivate(a), true, a);
  for (const a of ['104.16.0.35', '172.32.0.1', '8.8.8.8', '2606:4700::6810:1', '::ffff:8.8.8.8'])
    assert.equal(isPrivate(a), false, a);
});

test('the bridge passes 127.0.0.1:<port> on to the proxy socket and exits with its command', { timeout: LIMIT, skip: unix ? false : 'this sandbox forbids Unix sockets' }, async (t) => {
  const proxy = await startProxy({ dir: tempDir('proxy-'), hosts: [] });
  try {
    const free = createServer();
    await new Promise((r) => free.listen(0, '127.0.0.1', () => r(undefined)));
    const port = /** @type {import('node:net').AddressInfo} */ (free.address()).port;
    await new Promise((r) => free.close(r));
    const client = `const s = require('net').connect(${port}, '127.0.0.1', () => s.write('CONNECT x.com:443 HTTP/1.1\\r\\n\\r\\n')); s.on('data', (d) => process.exit(/ 403 /.test(String(d)) ? 7 : 1));`;
    const r = await run(process.execPath, [BRIDGE, proxy.socket, String(port), process.execPath, '-e', client], { timeoutMs: LIMIT });
    assert.equal(r.code, 7, r.stderr);
    assert.deepEqual(proxy.refused(), [{ host: 'x.com', why: 'unlisted' }]);
    assert.equal((await run(process.execPath, [BRIDGE, proxy.socket, String(port), 'definitely-missing-cmd'], { timeoutMs: LIMIT })).code, 127);
  } finally { await proxy.close(); }
});

test('bytes sent right after the CONNECT headers reach the upstream', { timeout: LIMIT }, async (t) => {
  const up = await echo();
  const proxy = await listening({ hosts: ['registry.npmjs.org'], lookup, connect: up.fakeConnect.bind(up) });
  try {
    const s = connect(proxy.port, '127.0.0.1', () => s.write('CONNECT registry.npmjs.org:443 HTTP/1.1\r\nHost: registry.npmjs.org:443\r\n\r\nping'));
    let got = '';
    await new Promise((resolve, reject) => {
      s.on('data', (d) => { got += String(d); if (got.includes('\r\n\r\n') && got.split('\r\n\r\n')[1] === 'ping') resolve(undefined); });
      s.once('error', reject);
      s.once('close', () => reject(new Error(`closed after ${JSON.stringify(got)}`)));
      t.signal.addEventListener('abort', () => { s.destroy(); reject(new Error(`timed out after ${JSON.stringify(got)}`)); }, { once: true });
    });
    assert.match(got, /^HTTP\/1.1 200/);
    assert.equal(got.split('\r\n\r\n')[1], 'ping');
    s.destroy();
  } finally { await proxy.close(); up.server.close(); }
});

test('a plain-HTTP request with an Upgrade header is refused, counted and recorded', { timeout: LIMIT }, async (t) => {
  const up = await echo();
  const proxy = await listening({ hosts: ['registry.npmjs.org'], lookup, connect: up.fakeConnect.bind(up) });
  try {
    const { reply, s } = await ask(t.signal, proxy.port, 'GET http://x.com/ HTTP/1.1\r\nHost: x.com\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    assert.match(reply, /^HTTP\/1.1 403/);
    s.destroy();
    assert.deepEqual(up.dialed, []);
    assert.deepEqual(proxy.refused(), [{ host: 'x.com', why: 'plain' }]);
    assert.equal(proxy.requests(), 1);
  } finally { await proxy.close(); up.server.close(); }
});

test('plain HTTP to a listed host is recorded as plain HTTP, not as unlisted', { timeout: LIMIT }, async (t) => {
  const proxy = await listening({ hosts: ['registry.npmjs.org'], lookup });
  try {
    const { reply, s } = await ask(t.signal, proxy.port, 'GET http://registry.npmjs.org/npm HTTP/1.1\r\nHost: registry.npmjs.org\r\n\r\n');
    assert.match(reply, /^HTTP\/1.1 403/);
    s.destroy();
    assert.deepEqual(proxy.refused(), [{ host: 'registry.npmjs.org', why: 'plain' }]);
  } finally { await proxy.close(); }
});

test('the proxy records the first 10 refused hosts and only counts the rest', { timeout: LIMIT }, async (t) => {
  const proxy = await listening({ hosts: [], lookup });
  try {
    for (let i = 0; i < 25; i++) (await ask(t.signal, proxy.port, `CONNECT made-up-${i}.test:443 HTTP/1.1\r\n\r\n`)).s.destroy();
    (await ask(t.signal, proxy.port, 'CONNECT made-up-0.test:443 HTTP/1.1\r\n\r\n')).s.destroy();
    assert.deepEqual(proxy.refused().map((r) => r.host), Array.from({ length: 10 }, (_, i) => `made-up-${i}.test`));
    assert.equal(proxy.moreRefused(), 15, 'refusals past the first 10 hosts; a recorded host again is not counted');
    assert.equal(proxy.requests(), 26);
  } finally { await proxy.close(); }
});

test('a plain request whose Host is not a host name is refused and recorded as (not a host name)', { timeout: LIMIT }, async (t) => {
  const proxy = await listening({ hosts: [], lookup });
  try {
    const { reply, s } = await ask(t.signal, proxy.port, 'GET / HTTP/1.1\r\nHost: a`](http://e.vil)\r\n\r\n');
    assert.match(reply, /^HTTP\/1.1 403/);
    s.destroy();
    assert.deepEqual(proxy.refused(), [{ host: '(not a host name)', why: 'plain' }]);
    assert.equal(proxy.requests(), 1);
  } finally { await proxy.close(); }
});

test('a CONNECT to a very long host name is refused and recorded cut to 100 characters', { timeout: LIMIT }, async (t) => {
  const proxy = await listening({ hosts: [], lookup });
  try {
    const { reply, s } = await ask(t.signal, proxy.port, `CONNECT ${'a'.repeat(500)}:443 HTTP/1.1\r\n\r\n`);
    assert.match(reply, /^HTTP\/1.1 403/);
    s.destroy();
    const [r] = proxy.refused();
    assert.equal(r.why, 'unlisted');
    assert.ok(r.host.length <= 100, String(r.host.length));
    assert.ok(r.host.startsWith('aaaa') && r.host.endsWith('…'), r.host);
  } finally { await proxy.close(); }
});

test('host names, IP addresses and ports are recorded as they are', { timeout: LIMIT }, async (t) => {
  const proxy = await listening({ hosts: [], lookup });
  try {
    for (const req of ['CONNECT x-1.example.com:443 HTTP/1.1\r\n\r\n', 'CONNECT 93.184.216.34:443 HTTP/1.1\r\n\r\n',
      'CONNECT [2606:4700::1]:443 HTTP/1.1\r\n\r\n', 'GET http://[::1]:8080/ HTTP/1.1\r\nHost: [::1]:8080\r\n\r\n',
      'GET / HTTP/1.1\r\nHost: plain.test:8080\r\n\r\n']) {
      const { reply, s } = await ask(t.signal, proxy.port, req);
      assert.match(reply, /^HTTP\/1.1 403/, req);
      s.destroy();
    }
    assert.deepEqual(proxy.refused().map((r) => r.host), ['x-1.example.com', '93.184.216.34', '2606:4700::1', '[::1]', 'plain.test:8080']);
  } finally { await proxy.close(); }
});

test('two refused hosts that are recorded the same are listed once and the other is counted', { timeout: LIMIT }, async (t) => {
  const proxy = await listening({ hosts: [], lookup });
  try {
    for (const bad of ['a`b', 'c`d', 'a`b']) (await ask(t.signal, proxy.port, `GET / HTTP/1.1\r\nHost: ${bad}\r\n\r\n`)).s.destroy();
    assert.deepEqual(proxy.refused(), [{ host: '(not a host name)', why: 'plain' }]);
    assert.equal(proxy.moreRefused(), 1);
    assert.equal(proxy.requests(), 3);
  } finally { await proxy.close(); }
});
