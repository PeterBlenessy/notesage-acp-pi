import { describe, expect, it } from "vitest";
import {
  AVAILABLE_MODES,
  DEFAULT_MODE_ID,
  MODE_AGENT,
  MODE_FULL_ACCESS,
  MODE_READ_ONLY,
  decisionForMode,
  isKnownMode,
  modeState,
} from "../src/modes";

describe("session modes", () => {
  it("maps each mode to its permission decision", () => {
    expect(decisionForMode(MODE_READ_ONLY)).toBe("block");
    expect(decisionForMode(MODE_AGENT)).toBe("prompt");
    expect(decisionForMode(MODE_FULL_ACCESS)).toBe("allow");
  });

  it("resolves an unknown mode to prompt, never to allow", () => {
    // A host on a newer/older build could set an id this one doesn't know.
    // Prompting keeps the agent usable; allowing would silently drop the gate.
    expect(decisionForMode("something-else")).toBe("prompt");
    expect(decisionForMode("")).toBe("prompt");
  });

  it("defaults to the prompting mode", () => {
    // Pre-modes behaviour was "always ask". A new session must not become more
    // permissive just because modes were added.
    expect(DEFAULT_MODE_ID).toBe(MODE_AGENT);
    expect(decisionForMode(DEFAULT_MODE_ID)).toBe("prompt");
  });

  it("advertises exactly the three modes it can enforce", () => {
    expect(AVAILABLE_MODES.map((m) => m.id)).toEqual([
      MODE_READ_ONLY,
      MODE_AGENT,
      MODE_FULL_ACCESS,
    ]);
    for (const mode of AVAILABLE_MODES) {
      expect(mode.name.length).toBeGreaterThan(0);
      expect(mode.description?.length ?? 0).toBeGreaterThan(0);
      expect(isKnownMode(mode.id)).toBe(true);
    }
  });

  it("avoids mode ids that Notesage's Local-Agent display table would relabel", () => {
    // Cross-repo invariant, holdable only by assertion: Notesage's
    // GOOSE_MODE_DISPLAY (src/lib/ai/acp-agent-state.ts) is consulted for ANY
    // Local Agent preset, pi included, and keys off Goose's ids. `auto` there
    // means "Full Access" — so shipping `auto` as our prompting mode would
    // label the safest working mode as the most permissive one in the picker.
    const GOOSE_DISPLAY_IDS = ["smart_approve", "approve", "auto", "chat"];
    for (const mode of AVAILABLE_MODES) {
      expect(GOOSE_DISPLAY_IDS).not.toContain(mode.id);
    }
  });

  it("uses ids Notesage already classifies into common permission levels", () => {
    // Mirrors MODE_ID_TO_COMMON in src/lib/ai/acp-agent-state.ts. `full-access`
    // in particular must classify, or the sandbox-conflict dialog won't fire
    // when the user picks an unrestricted mode under an active sandbox.
    const NOTESAGE_KNOWN_IDS = [
      "default", "read-only",
      "acceptEdits", "auto", "autoEdit", "code", "agent",
      "bypassPermissions", "full-access", "yolo",
      "architect", "plan",
    ];
    for (const mode of AVAILABLE_MODES) {
      expect(NOTESAGE_KNOWN_IDS).toContain(mode.id);
    }
  });

  it("builds a mode state carrying the current selection", () => {
    const state = modeState(MODE_READ_ONLY);
    expect(state.currentModeId).toBe(MODE_READ_ONLY);
    expect(state.availableModes).toEqual(AVAILABLE_MODES);
  });
});
