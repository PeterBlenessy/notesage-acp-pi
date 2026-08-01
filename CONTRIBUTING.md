# Contributing

## Getting set up

```bash
pnpm install
pnpm test        # unit + fake-pi integration
pnpm typecheck
```

The default suite needs nothing but Node — it drives a stub `pi` (`test/fake-pi`),
so it is fast and runs anywhere.

## Testing against a real pi

Two suites are skipped unless pointed at real binaries. They are the ones that
actually prove the protocol works, so run them before anything that touches
`src/pi-rpc.ts`, `src/permissions.ts` or the extensions:

```bash
# build the compiled adapter the E2E suite drives
./scripts/build-binaries.sh bun-darwin-arm64

PI_BINARY=/path/to/pi \
BRIDGE_BINARY=dist/notesage-acp-pi-aarch64-apple-darwin \
pnpm test
```

Requires [Bun](https://bun.sh) — build-time only. The published binaries are
self-contained and need no runtime.

## Things that will bite you

**The extensions run inside `pi`, not inside this package.** `extensions/*.ts`
is loaded by `pi` from its own config directory, in its own process. They cannot
import from `src/`, which is why several protocol values are duplicated on both
sides as independent literals: the permission marker, the `"Allow"` answer
string, and the `NOTESAGE_MCP_SERVERS` env key.

Nothing fails loudly when those drift — the adapter simply stops recognising the
extension's requests and every tool call silently blocks. `test/protocol-constants.test.ts`
is the only thing standing between that and a green suite. If you change one
side, change both.

**Never send `pi` an `abort` while a UI request is outstanding.** It wedges the
process. The deny and timeout paths answer the pending request first, then
abort. This is enforced in `PermissionBroker.cancelAll()` and `PiAcpAgent.cancel`,
and it is not a stylistic preference — it was found the hard way.

**The permission gate must fail closed.** Every path where approval cannot be
obtained has to block. See [SECURITY.md](SECURITY.md).

## Releasing

The version lives in two places — `package.json` and `src/version.ts`, the
latter being what the adapter reports over the ACP handshake. `test/version.test.ts`
asserts they match; bump both.

Tag `vX.Y.Z` and push it. The release workflow refuses a tag that disagrees
with `package.json`, gates on typecheck and tests, cross-compiles all four
platform binaries from a single runner, and publishes them with a
`notesage-acp-pi-SHA256SUMS` manifest.

That checksum filename is a wire contract — Notesage verifies against it by
name. Renaming it means a coordinated change on both sides.

## Commits

Conventional Commits (`fix:`, `feat:`, `refactor:`, `test:`, `chore:`). Explain
*why* in the body; the diff already says what.
