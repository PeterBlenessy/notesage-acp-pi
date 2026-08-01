// extension_ui_request ↔ ACP session/request_permission broker (task #9).
//
// Spike-#3 rules baked in:
//   1. NEVER abort while a UI request is outstanding — pi wedges. cancelAll()
//      answers every pending request (cancelled: true → the gate blocks) and
//      MUST be called before abort (PiAcpAgent.cancel does).
//   2. The 30s auto-deny lives on the Notesage side (its PermissionCard flow
//      responds "cancelled"); the broker adds a safety timeout as a last
//      resort so a crashed/unresponsive ACP client can't wedge pi forever.
//   3. Unknown UI requests (not carrying the permission marker) are answered
//      cancelled immediately — fail-safe, never wedge, never silently allow.

import type { PermissionOption, RequestPermissionResponse, ToolCallUpdate } from "@agentclientprotocol/sdk";
import type { PermissionPolicy } from "./modes";

export const PERMISSION_MARKER = "__NOTESAGE_PERMISSION__";
// Exported so test/protocol-constants.test.ts can lock it against the shipped
// permission-gate extension's copy — pi loads that extension standalone in its
// own process, so the two halves of this protocol cannot share an import and
// can only be kept in sync by assertion.
export const ALLOW = "Allow";
/** Settling a select with this prefix + text makes the text the block reason
 *  the model sees, instead of the gate's generic "Tool call denied". Locked
 *  against the extension's copy in test/protocol-constants.test.ts. */
export const BLOCK_REASON_PREFIX = "__NOTESAGE_BLOCK__";

export interface PermissionUiRequest {
  id: string;
  method?: string;
  title?: string;
  options?: string[];
}

export interface AcpPermissionAsk {
  toolCall: ToolCallUpdate;
  options: PermissionOption[];
}

export type RequestPermissionFn = (ask: AcpPermissionAsk) => Promise<RequestPermissionResponse>;
export type UiResponder = (response: { id: string; value?: string; cancelled?: true }) => void;

export const PERMISSION_OPTIONS: PermissionOption[] = [
  { optionId: "allow_once", name: "Allow", kind: "allow_once" },
  { optionId: "allow_always", name: "Allow always", kind: "allow_always" },
  { optionId: "reject_once", name: "Deny", kind: "reject_once" },
];

interface KnownTool {
  toolName: string;
  args: Record<string, unknown>;
  title: string;
}

export class PermissionBroker {
  /** toolCallId → info from tool_execution_start (enriches the ACP ask). */
  private readonly knownTools = new Map<string, KnownTool>();
  /** UI request id → settle function (idempotent). */
  private readonly pending = new Map<string, (value?: string) => void>();

  constructor(
    private readonly requestPermission: RequestPermissionFn,
    private readonly respond: UiResponder,
    private readonly safetyTimeoutMs = 120_000,
    /** Session-mode policy for the *active* session, read per request so a
     *  mode change mid-session takes effect on the next tool call without a
     *  respawn. Defaults to always prompting — the pre-modes behaviour. */
    private readonly policy: () => PermissionPolicy = () => ({ decision: "prompt" }),
    /** Diagnostics sink. Auto-decided calls never reach the host, so without
     *  this a Full Access session leaves no record of what was approved on the
     *  user's behalf, or which mode approved it. */
    private readonly log: (message: string) => void = () => {},
  ) {}

  get pendingCount(): number {
    return this.pending.size;
  }

  /** Feed every pi event; returns true when the event was consumed. */
  handle(e: Record<string, unknown>): boolean {
    if (e.type === "tool_execution_start") {
      const id = String(e.toolCallId ?? "");
      if (id) {
        this.knownTools.set(id, {
          toolName: String(e.toolName ?? "tool"),
          args: (e.args ?? {}) as Record<string, unknown>,
          title: String(e.toolName ?? "tool"),
        });
      }
      return false; // not consumed — the translator also needs it
    }
    if (e.type === "tool_execution_end") {
      this.knownTools.delete(String(e.toolCallId ?? ""));
      return false;
    }
    if (e.type !== "extension_ui_request") return false;

    const req = e as unknown as PermissionUiRequest;
    if (!req.id) return true;
    const envelope = this.parseMarker(req.title);
    if (!envelope) {
      // Not ours (or malformed) — answer immediately so pi can never wedge on
      // a UI surface the bridge doesn't understand. cancelled → gate blocks.
      this.respond({ id: req.id, cancelled: true });
      return true;
    }
    // Session-mode policy. Read Only and Full Access are answered here without
    // ever reaching the host, so neither costs a round-trip and neither can be
    // left hanging by an unresponsive client. Both are logged, because an
    // auto-decided call is invisible to the host's approval surfaces.
    const policy = this.policy();
    if (policy.decision === "allow") {
      this.log(`auto-allowed ${envelope.toolName} (mode policy)`);
      this.respond({ id: req.id, value: ALLOW });
      return true;
    }
    if (policy.decision === "block") {
      // Answered with a value, not `cancelled`: the prefix carries the reason
      // through to the gate so the model learns the refusal is session-wide
      // rather than a one-off denial it should retry.
      this.log(`auto-blocked ${envelope.toolName} (mode policy)`);
      this.respond({ id: req.id, value: `${BLOCK_REASON_PREFIX}${policy.reason}` });
      return true;
    }
    void this.ask(req.id, envelope.toolCallId, envelope.toolName);
    return true;
  }

  private parseMarker(title: string | undefined): { toolCallId: string; toolName: string } | null {
    if (!title?.startsWith(PERMISSION_MARKER)) return null;
    try {
      const parsed = JSON.parse(title.slice(PERMISSION_MARKER.length)) as {
        toolCallId?: unknown;
        toolName?: unknown;
      };
      return {
        toolCallId: String(parsed.toolCallId ?? ""),
        toolName: String(parsed.toolName ?? "tool"),
      };
    } catch {
      return null;
    }
  }

  private async ask(uiRequestId: string, toolCallId: string, toolName: string): Promise<void> {
    // Idempotent settle: first of {ACP outcome, cancelAll, safety timeout} wins.
    let settled = false;
    const settle = (value?: string) => {
      if (settled) return;
      settled = true;
      this.pending.delete(uiRequestId);
      clearTimeout(timer);
      if (value) this.respond({ id: uiRequestId, value });
      else this.respond({ id: uiRequestId, cancelled: true });
    };
    this.pending.set(uiRequestId, settle);
    const timer = setTimeout(() => settle(), this.safetyTimeoutMs);

    const known = this.knownTools.get(toolCallId);
    try {
      const res = await this.requestPermission({
        toolCall: {
          toolCallId,
          ...(known ? { title: `${known.toolName}`, rawInput: known.args } : { title: toolName }),
        },
        options: PERMISSION_OPTIONS,
      });
      const outcome = res.outcome;
      if (outcome && outcome.outcome === "selected" && String(outcome.optionId).startsWith("allow")) {
        settle(ALLOW);
      } else {
        settle(); // rejected / cancelled / unknown → cancelled → gate blocks
      }
    } catch {
      settle(); // ACP transport error → block, never wedge
    }
  }

  /** Answer every outstanding request (cancelled). MUST run before abort. */
  cancelAll(): void {
    for (const settle of [...this.pending.values()]) settle();
  }
}
