// Session modes end-to-end against the gated fake pi: the mode decides whether
// a gated tool call reaches the host at all.
//
// The load-bearing assertion in the Read Only / Full Access cases is `asked`
// staying empty. Both modes are answered inside the bridge, so they cost no
// round-trip and cannot be left hanging by an unresponsive client.
import { afterEach, describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import type { RequestPermissionResponse } from "@agentclientprotocol/sdk";
import { PiAcpAgent } from "../src/acp-server";
import { PiRpc } from "../src/pi-rpc";
import { MODE_AGENT, MODE_FULL_ACCESS, MODE_READ_ONLY } from "../src/modes";
import type { SessionUpdate } from "../src/translate";

const FAKE_PI = join(dirname(fileURLToPath(import.meta.url)), "fake-pi");

let agents: PiAcpAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.map((a) => a.shutdown()));
  agents = [];
});

function makeAgent(decide: () => Promise<RequestPermissionResponse>) {
  const updates: SessionUpdate[] = [];
  const asked: string[] = [];
  const agent = new PiAcpAgent({
    spawnPi: ({ cwd }, onEvent) =>
      new PiRpc({ piBin: FAKE_PI, cwd, env: { ...process.env, FAKE_PI_GATED_TOOL: "1" }, onEvent }),
    onSessionUpdate: (_sid, u) => updates.push(u),
    requestPermission: (_sid, ask) => {
      asked.push(ask.toolCall.toolCallId ?? "");
      return decide();
    },
  });
  agents.push(agent);
  return { agent, updates, asked };
}

const lastToolStatus = (updates: SessionUpdate[]) =>
  updates.filter((u) => u.sessionUpdate === "tool_call_update").at(-1);

describe("session modes", () => {
  it("advertises its modes on session/new so the client can build a picker", async () => {
    const { agent } = makeAgent(async () => ({ outcome: { outcome: "cancelled" } }));
    const res = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    expect(res.modes?.currentModeId).toBe(MODE_AGENT);
    expect(res.modes?.availableModes.map((m) => m.id)).toEqual([
      MODE_READ_ONLY,
      MODE_AGENT,
      MODE_FULL_ACCESS,
    ]);
  });

  it("Read Only: refuses the tool without ever asking the host", async () => {
    const { agent, updates, asked } = makeAgent(async () => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.setSessionMode({ sessionId, modeId: MODE_READ_ONLY });

    const res = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "write it" }] });

    expect(res.stopReason).toBe("end_turn");
    expect(asked).toHaveLength(0); // no PermissionCard was raised
    expect(lastToolStatus(updates)).toMatchObject({ status: "failed" });
  });

  it("Full Access: runs the tool without ever asking the host", async () => {
    // decide() would reject if consulted — proving the allow came from the mode
    // and not from a permissive host answer.
    const { agent, updates, asked } = makeAgent(async () => ({
      outcome: { outcome: "selected", optionId: "reject_once" },
    }));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.setSessionMode({ sessionId, modeId: MODE_FULL_ACCESS });

    const res = await agent.prompt({ sessionId, prompt: [{ type: "text", text: "write it" }] });

    expect(res.stopReason).toBe("end_turn");
    expect(asked).toHaveLength(0);
    expect(lastToolStatus(updates)).toMatchObject({ status: "completed" });
  });

  it("Agent: still asks the host, and a mode change takes effect without a respawn", async () => {
    const { agent, updates, asked } = makeAgent(async () => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });

    await agent.setSessionMode({ sessionId, modeId: MODE_FULL_ACCESS });
    await agent.prompt({ sessionId, prompt: [{ type: "text", text: "write it" }] });
    expect(asked).toHaveLength(0);

    // Same live pi child, no respawn — the broker reads the mode per request.
    await agent.setSessionMode({ sessionId, modeId: MODE_AGENT });
    await agent.prompt({ sessionId, prompt: [{ type: "text", text: "write it again" }] });

    expect(asked).toHaveLength(1);
    expect(lastToolStatus(updates)).toMatchObject({ status: "completed" });
  });

  it("rejects an unknown mode id rather than silently ignoring it", async () => {
    const { agent } = makeAgent(async () => ({ outcome: { outcome: "cancelled" } }));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await expect(agent.setSessionMode({ sessionId, modeId: "nope" })).rejects.toThrow(/nope/);
  });

  it("rejects an unknown session rather than recording policy nothing reads", async () => {
    // Succeeding silently would let a client believe it had tightened a
    // session that then keeps running under the old mode.
    const { agent } = makeAgent(async () => ({ outcome: { outcome: "cancelled" } }));
    await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await expect(
      agent.setSessionMode({ sessionId: "/not/a/real/session.jsonl", modeId: MODE_READ_ONLY }),
    ).rejects.toThrow(/Unknown session/);
  });

  it("keeps each session's mode separate when switching between them", async () => {
    // One shared field would leak the restricted session's policy into the
    // other — or worse, leak the permissive one back.
    const { agent, asked } = makeAgent(async () => ({
      outcome: { outcome: "selected", optionId: "allow_once" },
    }));
    const a = (await agent.newSession({ cwd: "/tmp", mcpServers: [] })).sessionId;
    const b = (await agent.newSession({ cwd: "/tmp", mcpServers: [] })).sessionId;
    await agent.setSessionMode({ sessionId: a, modeId: MODE_READ_ONLY });
    await agent.setSessionMode({ sessionId: b, modeId: MODE_FULL_ACCESS });

    await agent.prompt({ sessionId: a, prompt: [{ type: "text", text: "write it" }] });
    await agent.prompt({ sessionId: b, prompt: [{ type: "text", text: "write it" }] });

    // Neither reached the host, and each was governed by its own policy.
    expect(asked).toHaveLength(0);
    expect((await agent.loadSession({ sessionId: a, cwd: "/tmp", mcpServers: [] })).modes?.currentModeId)
      .toBe(MODE_READ_ONLY);
    expect((await agent.loadSession({ sessionId: b, cwd: "/tmp", mcpServers: [] })).modes?.currentModeId)
      .toBe(MODE_FULL_ACCESS);
  });

  it("setting a session back to the default clears it rather than remembering it", async () => {
    const { agent } = makeAgent(async () => ({ outcome: { outcome: "cancelled" } }));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.setSessionMode({ sessionId, modeId: MODE_READ_ONLY });
    await agent.setSessionMode({ sessionId, modeId: MODE_AGENT });
    const loaded = await agent.loadSession({ sessionId, cwd: "/tmp", mcpServers: [] });
    expect(loaded.modes?.currentModeId).toBe(MODE_AGENT);
  });

  it("re-advertises the session's own mode on session/load, not the default", async () => {
    const { agent } = makeAgent(async () => ({ outcome: { outcome: "cancelled" } }));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.setSessionMode({ sessionId, modeId: MODE_READ_ONLY });

    const loaded = await agent.loadSession({ sessionId, cwd: "/tmp", mcpServers: [] });

    expect(loaded.modes?.currentModeId).toBe(MODE_READ_ONLY);
  });

  it("a fork inherits its parent's mode instead of widening back to the default", async () => {
    // Escalation guard: branching from a Read Only session must not hand the
    // branch a prompting (or worse) policy the user never selected.
    const { agent } = makeAgent(async () => ({ outcome: { outcome: "cancelled" } }));
    const { sessionId } = await agent.newSession({ cwd: "/tmp", mcpServers: [] });
    await agent.setSessionMode({ sessionId, modeId: MODE_READ_ONLY });

    const forked = await agent.unstable_forkSession({ sessionId, cwd: "/tmp" });

    expect(forked.sessionId).not.toBe(sessionId);
    expect(forked.modes?.currentModeId).toBe(MODE_READ_ONLY);
  });
});
