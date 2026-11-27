# 8. Setup reaches only listed hosts through the factory's proxy

Date: 2026-11-27 · Status: accepted · Adds to [ADR 0001](0001-separate-env-allowlists.md) and [ADR 0005](0005-the-factorys-git-runs-confined.md)

## Context

Setup runs the branch's code before anyone has read it: install scripts, a build step. It ran with the host's full network, so it could reach any internet host, `127.0.0.1`, the local network and `169.254.169.254`, and send the worktree's code anywhere (#220). Checks already run without network; setup needs some, to download dependencies.

## Decision

- A target lists the hosts its setup needs in `setupHosts`, for example `['registry.npmjs.org']`.
- With `setupHosts` a list, setup runs with `--unshare-net`: it has no network of its own. Its only way out is an HTTP CONNECT proxy the factory starts for that setup (`lib/proxy.mjs`, Node's standard library only). The proxy listens on a Unix socket in a temporary folder that is bound into the sandbox read-only. Inside, a small Node bridge (`lib/proxy-bridge.mjs`) listens on `127.0.0.1:3128`, passes connections on to the socket, and runs the setup command.
- The proxy allows `CONNECT host:443` for listed hosts only. It refuses every other host and port, and plain HTTP. It also refuses a listed host that resolves to a loopback, private, link-local or unspecified address, and connects to the address it checked, so the name is not looked up twice. It records each refused host with the reason (not listed, another port, a local address, plain HTTP), the first 10 only; past those it counts, since setup's code could make up any number of names.
- The factory sets `HTTPS_PROXY`, `HTTP_PROXY`, `https_proxy`, `http_proxy`, `npm_config_proxy` and `NODE_USE_ENV_PROXY=1` itself, after the target's `env`, so a target cannot point them elsewhere. They are never passed on from the factory's own environment (ADR 0001).
- The proxy stops when setup ends, and its folder is removed.
- When setup fails, the stop comment names the refused hosts, each with its reason: "setup tried to reach `x.com`, which is not in `setupHosts`", and how many more it refused. If the proxy saw no request at all, it says the tool may ignore `HTTPS_PROXY`.
- `setupHosts: null`, the default, keeps today's full network, and the factory warns about it at startup.
- Checks, agents and the factory's confined git never get the proxy (ADR 0005). No default list holds `github.com`.
- `lib/proxy.mjs` and `lib/proxy-bridge.mjs` are protected files of the factory's own target.

Considered and not taken: Claude Code's sandbox proxy (it would need a new dependency), and limiting the agents' own network (out of scope here).

## Consequences

A target with `setupHosts` gives setup only the hosts it names, over TLS. A listed host can still receive what setup sends it, so list only hosts you trust with the worktree's code. A tool that ignores the proxy variables fails its downloads, and the stop says why. Do not give checks or the confined git the proxy, and do not let a target's `env` override the proxy variables.
