// Setup's only way out when the target lists setupHosts: an HTTP CONNECT proxy on a
// Unix socket. It tunnels `CONNECT host:443` for listed hosts only, and refuses
// everything else, plain HTTP included, and any name that resolves to this machine
// or the local network. It runs in the factory, outside the sandbox (ADR 0008).
import { createServer } from 'node:http';
import { connect as netConnect, isIPv4 } from 'node:net';
import { lookup as dnsLookup } from 'node:dns/promises';
import { rmSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Why the proxy refused a host: not in setupHosts, a port other than 443, a name that resolves to
 * this machine or the local network, or plain HTTP. `host` is `host:port` for 'port'.
 * @typedef {{ host: string, why: 'unlisted' | 'port' | 'private' | 'plain' }} Refusal
 */

// How many refused hosts the proxy records; past that it only counts.
export const REFUSED_MAX = 10;

// Setup's code chose the host, and the stop comment shows it in a code span: keep only what looks like a host name,
// an IPv4 or IPv6 address (bracketed or not) with an optional port, and cut it short.
const HOST = /^(?:[a-z0-9.-]+|\[[0-9a-f:.]+\]|[0-9a-f:.]+)(?::\d+)?$/i;
const HOST_MAX = 100;
/** @param {string} host */
const hostName = (host) => !HOST.test(host) ? '(not a host name)'
  : host.length > HOST_MAX ? `${host.slice(0, HOST_MAX - 1)}…` : host;

const v4 = (a) => a.split('.').map(Number);

/**
 * Whether an address is loopback, private, link-local, carrier-grade NAT or unspecified.
 * @param {string} address an IPv4 or IPv6 address
 * @returns {boolean}
 */
export function isPrivate(address) {
  const a = address.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(a);
  if (mapped) return isPrivate(mapped[1]);
  if (isIPv4(a)) {
    const [x, y] = v4(a);
    return x === 0 || x === 10 || x === 127 || (x === 169 && y === 254) || (x === 172 && y >= 16 && y <= 31)
      || (x === 192 && y === 168) || (x === 100 && y >= 64 && y <= 127);
  }
  return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a);
}

/**
 * The proxy, not yet listening.
 * @param {{ hosts: string[],
 *   lookup?: (host: string) => Promise<{ address: string }[]>,
 *   connect?: (port: number, address: string) => import('node:net').Socket }} opts
 *   lookup and connect are for tests; by default the system resolver and a TCP connection.
 * @returns {{ server: import('node:http').Server, refused: () => Refusal[], moreRefused: () => number, requests: () => number, close: () => Promise<void> }}
 *   refused: the first REFUSED_MAX refused hosts, each once with its reason, in order; moreRefused: how many refusals
 *   came after those, for other hosts (setup's code is untrusted, so the list stays short); requests: how many came in.
 *   close stops the server and cuts open tunnels.
 */
export function proxyServer({ hosts, lookup = (h) => dnsLookup(h, { all: true }), connect = (p, a) => netConnect(p, a) }) {
  const allowed = new Set(hosts.map((h) => h.toLowerCase()));
  /** @type {Map<string, Refusal>} */
  const refused = new Map();
  const open = new Set();
  let requests = 0, more = 0;
  const track = (s) => { open.add(s); s.on('close', () => open.delete(s)); s.on('error', () => s.destroy()); };
  /** @type {(host: string, why: Refusal['why']) => void} */
  const record = (host, why) => {
    const key = `${why} ${host}`;
    if (refused.has(key)) return;
    const shown = { host: hostName(host), why };
    // Two hosts can look the same once checked and cut; list it once and count the other.
    if (refused.size < REFUSED_MAX && ![...refused.values()].some((r) => r.why === why && r.host === shown.host)) refused.set(key, shown);
    else more++;
  };
  const refuse = (s, host, why) => { record(host, why); s.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); };

  const server = createServer();
  server.on('connection', track);
  // Plain HTTP: nothing that is not encrypted leaves, whatever the host.
  const plainHost = (req) => {
    requests++;
    let host = req.headers.host ?? '';
    try { host = new URL(req.url ?? '').hostname || host; } catch { /* keep the Host header */ }
    return host.toLowerCase();
  };
  server.on('request', (req, res) => {
    record(plainHost(req), 'plain');
    res.writeHead(403, { Connection: 'close' }).end();
  });
  // A plain request asking to upgrade (a WebSocket, say) skips 'request'; refuse it the same way.
  server.on('upgrade', (req, client) => refuse(client, plainHost(req), 'plain'));
  server.on('connect', async (req, client, head) => {
    requests++;
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(req.url ?? '');
    const host = (m?.[1] ?? req.url ?? '').toLowerCase(), port = Number(m?.[2]);
    if (!allowed.has(host)) return refuse(client, host, 'unlisted');
    if (port !== 443) return refuse(client, `${host}:${port}`, 'port');
    let addresses;
    try { addresses = await lookup(host); } catch { addresses = []; }
    if (!addresses.length) return client.end('HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n');
    // One private address is enough to refuse: the name could point anywhere next time.
    if (addresses.some(({ address }) => isPrivate(address))) return refuse(client, host, 'private');
    const upstream = connect(port, addresses[0].address);
    track(upstream);
    upstream.on('close', () => client.destroy());
    client.on('close', () => upstream.destroy());
    upstream.once('connect', () => {
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      // What the client sent right after the headers (a TLS hello, often) arrives in head.
      if (head?.length) upstream.write(head);
      upstream.pipe(client).pipe(upstream);
    });
  });
  return {
    server,
    refused: () => [...refused.values()],
    moreRefused: () => more,
    requests: () => requests,
    close: () => new Promise((resolve) => { for (const s of open) s.destroy(); server.close(() => resolve()); }),
  };
}

/**
 * Starts the proxy on `<dir>/proxy.sock`.
 * @param {{ dir: string, hosts: string[] }} opts
 * @returns {Promise<ReturnType<typeof proxyServer> & { socket: string }>} close also removes the socket
 */
export async function startProxy({ dir, hosts }) {
  const proxy = proxyServer({ hosts });
  const socket = join(dir, 'proxy.sock');
  await new Promise((resolve, reject) => { proxy.server.once('error', reject); proxy.server.listen(socket, () => resolve(undefined)); });
  return { ...proxy, socket, close: () => proxy.close().then(() => rmSync(socket, { force: true })) };
}
