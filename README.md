# notesage-pi-acp

An [Agent Client Protocol](https://agentclientprotocol.com) (ACP) adapter for
[pi](https://github.com/earendil-works/pi).

It presents ACP over stdio and drives `pi --mode rpc` as a child process,
translating between the two protocols. Built for
[Notesage](https://github.com/PeterBlenessy/notesage)'s Local Agent preset, but
it is a general-purpose adapter — any ACP client can drive pi through it.

## Why another pi ACP adapter?

[`svkozak/pi-acp`](https://github.com/svkozak/pi-acp) already bridges ACP to pi
and works with Zed. This adapter exists because it implements three things that
one explicitly does not, all of which a permission-gated host needs:

| Capability | `svkozak/pi-acp` | this adapter |
| --- | --- | --- |
| `session/request_permission` | not supported | **yes** — every non-read-only tool call is gated |
| MCP pass-through | accepted, not wired to pi | **yes** — stdio servers spawned under pi's sandbox |
| Cancellation | not supported | **yes** — with the abort-ordering rule below |

If you don't need permission gating or MCP, the incumbent is the more
established choice.

## How it works

```
ACP client  <--stdio/ACP-->  notesage-pi-acp  <--stdio/JSONL-->  pi --mode rpc
```

- **Sessions.** ACP `sessionId` *is* pi's session file path — opaque to the
  client, survives adapter restarts, and is exactly what pi's `switch_session`
  consumes. ACP `session/fork` maps to pi's `clone` (duplicate the active
  branch), **not** pi's rewind-style `fork`.
- **Events.** pi's event stream becomes ACP session updates: text and thinking
  chunks, `tool_call` / `tool_call_update` (with Diff content derived from edit
  and write arguments), and `usage_update` from `get_session_stats`.
- **Permissions.** The shipped `permission-gate` extension blocks non-read-only
  tool calls behind `ctx.ui.select`; the adapter brokers that
  `extension_ui_request` into an ACP `session/request_permission` and routes the
  answer back. Block-by-default when there is no UI.
- **MCP.** The shipped `mcp-tools` extension reads stdio server configs from the
  `NOTESAGE_MCP_SERVERS` environment variable — so resolved secrets ride the
  process environment and never touch disk — spawns each server under pi's
  sandbox, and registers its tools.

### Load-bearing invariant

**Never send pi an `abort` while an `extension_ui_request` is outstanding** — it
wedges pi. The deny and timeout paths answer the pending UI request
(`cancelled: true`) *first*, then abort. Enforced in
`PermissionBroker.cancelAll()` and `PiAcpAgent.cancel`.

## Usage

```
notesage-pi-acp --pi-bin <path-to-pi> -- [pi args...]
```

Everything after `--` is passed through to pi, so the host can regenerate
provider/model/session arguments and respawn on change:

```
notesage-pi-acp --pi-bin /usr/local/bin/pi -- \
  --provider local --model qwen3-8b --session-dir ~/.pi/sessions
```

The adapter spawns pi in its own process group and group-kills on teardown, so
no pi grandchildren survive the adapter exiting.

## Install

Self-contained platform binaries are published on the
[releases page](https://github.com/PeterBlenessy/notesage-pi-acp/releases) with a
`SHA256SUMS` manifest. No Node or Bun runtime is required to run them.

## Development

```bash
pnpm install
pnpm test          # unit + fake-pi integration
pnpm typecheck
```

The real-pi and compiled-binary suites are opt-in — they skip unless pointed at
real binaries:

```bash
PI_BINARY=/path/to/pi BRIDGE_BINARY=/path/to/compiled/notesage-pi-acp pnpm test
```

Build release binaries (requires [Bun](https://bun.sh), build-time only):

```bash
./scripts/build-binaries.sh                  # all four platforms
./scripts/build-binaries.sh bun-darwin-arm64 # single target
```

## Compatibility

Verified against **pi 0.80.6**. pi ships multiple 0.x releases per week and its
RPC and extension surfaces are not yet stable, so hosts are advised to pin an
exact tested pi version rather than tracking latest.

## License

MIT — see [LICENSE](LICENSE).
