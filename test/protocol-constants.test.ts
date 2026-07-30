// Drift lock for the adapter <-> extension protocol constants.
//
// The shipped extensions run INSIDE pi, in pi's own process, loaded from
// PI_CODING_AGENT_DIR as standalone files. They therefore cannot import from
// this package at runtime, and every value on the wire between them and the
// adapter is duplicated as an independent literal on each side.
//
// Nothing fails loudly when those copies drift: change the marker on one side
// and the adapter simply stops recognising the extension's UI request, so
// permission prompts never reach the client and tool calls silently block.
// These assertions are the only thing standing between that and a green suite.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PERMISSION_MARKER, ALLOW } from "../src/permissions";
import { MCP_SERVERS_ENV } from "../src/mcp-handoff";
import {
  PERMISSION_MARKER as EXT_PERMISSION_MARKER,
  ALLOW as EXT_ALLOW,
} from "../extensions/permission-gate";

const EXT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "extensions");

describe("adapter <-> extension protocol constants", () => {
  it("permission marker matches on both sides of the UI-request envelope", () => {
    expect(EXT_PERMISSION_MARKER).toBe(PERMISSION_MARKER);
  });

  it("the allow answer string matches — the broker settles with it, the gate compares against it", () => {
    // PermissionBroker settles the pending select with ALLOW; permission-gate
    // treats anything !== its own ALLOW as a denial. A mismatch turns every
    // approval into a silent block.
    expect(EXT_ALLOW).toBe(ALLOW);
  });

  it("the MCP handoff env key matches the name the extension reads", () => {
    // mcp-tools.ts reads process.env.NOTESAGE_MCP_SERVERS as a bare literal, so
    // this is asserted against the file text rather than an import.
    const source = readFileSync(join(EXT_DIR, "mcp-tools.ts"), "utf8");
    expect(source).toContain(`process.env.${MCP_SERVERS_ENV}`);
  });
});
