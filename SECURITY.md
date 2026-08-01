# Security

## Reporting a vulnerability

Please report security issues privately via [GitHub Security
Advisories](https://github.com/PeterBlenessy/notesage-acp-pi/security/advisories/new)
rather than a public issue.

Include what you did, what happened, and which versions of this adapter and of
`pi` you were running. A proof of concept helps but is not required.

## What this component is responsible for

This adapter sits between an ACP client and a `pi` process. `pi` can read
files, write files and run commands, so the adapter is on the path of every
such decision. Three properties are load-bearing, and a break in any of them is
a security issue rather than a bug:

**Tool calls are blocked by default.** The shipped `permission-gate` extension
intercepts every non-read-only tool call and holds it until the host approves.
Every failure path — no UI available, a handler error, a cancelled request —
must **block**, never fall through to allow. If you can find an input that
causes a non-read-only tool call to execute without an approval, that is a
vulnerability.

**MCP secrets never touch disk.** Server credentials reach `pi` through the
process environment (`NOTESAGE_MCP_SERVERS`), deliberately not through a config
file. A path that causes them to be written to disk, logged, or echoed into an
ACP message is a vulnerability.

**The adapter is not a sandbox.** It does not confine `pi`; it brokers
permission decisions. Filesystem and network confinement are the host's job —
in Notesage's case an OS-level sandbox. Do not rely on this adapter alone to
contain an untrusted agent.

## Trust model

- The **host** (ACP client) is trusted. It decides what to approve, and the
  adapter faithfully relays those decisions.
- **`pi` and the model driving it are not trusted** to respect boundaries on
  their own. That is the entire reason the gate exists.
- **Extension code shipped in this repo runs inside `pi`**, not inside the
  adapter. It is written to fail closed.

## Supported versions

This is pre-1.0 and only the latest release is supported. `pi` itself moves
quickly and its RPC and extension surfaces are not yet stable, so hosts are
advised to pin an exact tested `pi` version rather than tracking latest.
