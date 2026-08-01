import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { BRIDGE_VERSION } from "../src/version";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// The version exists in two places that cannot see each other: package.json,
// which names the release, and src/version.ts, which the adapter reports as
// `agentInfo.version` over the ACP handshake.
//
// Nothing fails loudly when they drift. A release would ship a binary that
// misreports its own version to the host — and the host pins the adapter BY
// version, so a mismatch is not cosmetic: it makes "which build is actually
// running" unanswerable at exactly the moment you need to answer it.

describe("version", () => {
  it("matches package.json", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as {
      version: string;
    };
    expect(BRIDGE_VERSION).toBe(pkg.version);
  });

  it("is a plain semver triple, so a tag can be derived from it", () => {
    // The release workflow checks the pushed tag against package.json; anything
    // exotic here would break that comparison rather than fail it usefully.
    expect(BRIDGE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
