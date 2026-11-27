// Runs inside setup's sandbox, which has no network: listens on 127.0.0.1:<port>,
// passes each connection on to the factory's proxy socket, and runs the setup
// command. Exits with the command's code. Usage: node proxy-bridge.mjs <socket> <port> <cmd> [args…]
import { createServer, connect } from 'node:net';
import { spawn } from 'node:child_process';

const [socket, port, cmd, ...args] = process.argv.slice(2);
const server = createServer((c) => {
  const up = connect(socket);
  c.on('error', () => up.destroy());
  up.on('error', () => c.destroy());
  c.pipe(up).pipe(c);
});
server.listen(Number(port), '127.0.0.1', () => {
  const child = spawn(cmd, args, { stdio: 'inherit' });
  child.on('error', (e) => { console.error(e.message); process.exit(127); });
  child.on('exit', (code) => process.exit(code ?? 1));
});
server.on('error', (e) => { console.error(`setup proxy bridge: ${e.message}`); process.exit(1); });
