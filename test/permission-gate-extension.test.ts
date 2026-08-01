// The shipped permission-gate extension, exercised directly.
//
// It normally runs inside pi's process, loaded from PI_CODING_AGENT_DIR, so
// nothing else in this suite calls it as a function. Its refusal path is the
// only place the model is told *why* a call was blocked, and a wrong answer
// there is invisible: the turn still completes, the tool just fails.
import { describe, expect, it, vi } from "vitest";
import createGate, {
  ALLOW,
  BLOCK_REASON_PREFIX,
  DENY,
} from "../extensions/permission-gate";

type Handler = (
  event: { toolCallId: string; toolName: string; input: Record<string, unknown> },
  ctx: { hasUI: boolean; ui: { select: (t: string, o: string[]) => Promise<string | undefined> } },
) => Promise<{ block: true; reason?: string } | undefined>;

/** Install the gate and hand back its tool_call handler. */
function gateHandler(): Handler {
  let handler: Handler | undefined;
  createGate({
    on: (_event: string, h: Handler) => {
      handler = h;
    },
    registerTool: () => {},
  } as never);
  if (!handler) throw new Error("gate registered no tool_call handler");
  return handler;
}

const ctxWith = (answer: string | undefined, hasUI = true) => ({
  hasUI,
  ui: { select: vi.fn(async () => answer) },
});

const call = (toolName: string) => ({ toolCallId: "tc-1", toolName, input: {} });

describe("permission-gate extension", () => {
  it("lets read-only tools through without asking", async () => {
    const handler = gateHandler();
    const ctx = ctxWith(undefined);
    for (const tool of ["read", "grep", "find", "ls"]) {
      expect(await handler(call(tool), ctx)).toBeUndefined();
    }
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });

  it("asks about every write-capable built-in", async () => {
    // pi's built-ins are read, bash, edit, write, grep, find, ls
    // (packages/coding-agent/docs/extensions.md). The three that can change
    // something must all reach the host.
    const handler = gateHandler();
    for (const tool of ["bash", "edit", "write"]) {
      const ctx = ctxWith(ALLOW);
      expect(await handler(call(tool), ctx)).toBeUndefined();
      expect(ctx.ui.select).toHaveBeenCalledOnce();
    }
  });

  it("asks about tools it has never heard of, rather than assuming they are safe", async () => {
    // MCP tools, extension tools, and anything a future pi adds land here.
    const handler = gateHandler();
    const ctx = ctxWith(DENY);
    expect(await handler(call("some_mcp_tool"), ctx)).toMatchObject({ block: true });
    expect(ctx.ui.select).toHaveBeenCalledOnce();
  });

  it("uses a supplied reason so a session-wide refusal says so", async () => {
    const handler = gateHandler();
    const reason = "This session is in Read Only mode. Do not retry.";
    const result = await handler(call("write"), ctxWith(`${BLOCK_REASON_PREFIX}${reason}`));
    expect(result).toEqual({ block: true, reason });
  });

  it("never leaks the marker into the reason the model reads", async () => {
    const handler = gateHandler();
    const result = await handler(call("write"), ctxWith(`${BLOCK_REASON_PREFIX}nope`));
    expect(result?.reason).not.toContain(BLOCK_REASON_PREFIX);
  });

  it("falls back to a generic denial for a human 'Deny' or a cancelled request", async () => {
    const handler = gateHandler();
    expect(await handler(call("write"), ctxWith(DENY))).toEqual({
      block: true,
      reason: "Tool call denied",
    });
    expect(await handler(call("write"), ctxWith(undefined))).toEqual({
      block: true,
      reason: "Tool call denied",
    });
  });

  it("blocks when there is no UI to ask", async () => {
    // -p / --mode json. Fail-safe: no host means no approval, not free rein.
    const handler = gateHandler();
    const ctx = ctxWith(ALLOW, false);
    expect(await handler(call("write"), ctx)).toMatchObject({ block: true });
    expect(ctx.ui.select).not.toHaveBeenCalled();
  });
});
