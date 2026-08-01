// ACP session modes, mapped onto the shipped permission gate.
//
// pi has no permission model of its own — its docs/security.md is explicit:
// "Pi does not include a built-in sandbox. Built-in tools can read files,
// write files, edit files, and run shell commands with the permissions of the
// pi process." Permission gating is an extension concern, and our shipped
// permission-gate.ts routes every non-read-only tool call to the host as an
// extension_ui_request.
//
// Modes are therefore enforced HERE, in the bridge, by deciding how to answer
// that request. The gate extension stays stateless and unchanged: it always
// asks, and the bridge answers immediately (allow / block) or forwards to the
// host (prompt). Keeping mode state out of pi's process also means a mode
// switch never requires a respawn.
//
// ID choice is deliberate. These ids must land in Notesage's MODE_ID_TO_COMMON
// table so the host classifies them correctly — notably so the sandbox-conflict
// dialog recognises `full-access` as unrestricted. `auto` is specifically
// avoided: Notesage's Local-Agent display table maps `auto` to "Full Access"
// (a Goose id), so using it for a prompting mode would label the *safest*
// working mode as the most permissive one.

import type { SessionMode, SessionModeState } from "@agentclientprotocol/sdk";

export const MODE_READ_ONLY = "read-only";
export const MODE_AGENT = "agent";
export const MODE_FULL_ACCESS = "full-access";

/** Prompting mode — matches the bridge's behaviour before modes existed, so an
 *  existing session's semantics are unchanged by this feature. */
export const DEFAULT_MODE_ID = MODE_AGENT;

export const AVAILABLE_MODES: SessionMode[] = [
  {
    id: MODE_READ_ONLY,
    name: "Read Only",
    description: "Can read files and search — every write or command is refused without asking.",
  },
  {
    id: MODE_AGENT,
    name: "Agent",
    description: "Can read and search freely; asks before writing files or running commands.",
  },
  {
    id: MODE_FULL_ACCESS,
    name: "Full Access",
    description: "Writes files and runs commands without asking. Use with caution.",
  },
];

/** What the broker should do with a gated tool call in a given mode. */
export type PermissionDecision = "prompt" | "allow" | "block";

export function isKnownMode(modeId: string): boolean {
  return AVAILABLE_MODES.some((m) => m.id === modeId);
}

/**
 * Unknown ids resolve to "prompt" rather than throwing or allowing: a host that
 * somehow sets a mode this build doesn't know still gets a working, asking
 * agent instead of a silently unrestricted or bricked one.
 */
export function decisionForMode(modeId: string): PermissionDecision {
  switch (modeId) {
    case MODE_FULL_ACCESS:
      return "allow";
    case MODE_READ_ONLY:
      return "block";
    default:
      return "prompt";
  }
}

export function modeState(currentModeId: string): SessionModeState {
  return { currentModeId, availableModes: AVAILABLE_MODES };
}
