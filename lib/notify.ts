/**
 * Telling a human something happened.
 *
 * The gap this closes is the largest one left in the loop: the agent decides
 * a $4,000 spindle needs a person, and then nothing tells the person. The
 * order sits in the queue until somebody happens to open the panel. Same for
 * a gateway that stopped reporting — detected, and then silently true.
 *
 * ponytail: one outbound webhook carrying JSON, not an integration per
 * destination. `text` is included because Slack and Discord both render it,
 * and everything else (n8n, Zapier, a Telegram bridge, a plant's own
 * andon board) reads the structured fields next to it.
 */
export type NotifyKind = "approval" | "stale" | "failure" | "budget";

export interface NotifyEvent {
  kind: NotifyKind;
  title: string;
  detail: string;
  /** Deep link a human can open — a transaction, or the panel. */
  url?: string;
  /** Distinct events that should not each page somebody. Defaults to kind. */
  key?: string;
}

const webhook = () => process.env.NOTIFY_WEBHOOK_URL;

/** How long the same key stays quiet after firing once. */
const cooldownMs = () => Number(process.env.NOTIFY_COOLDOWN_MINUTES ?? 60) * 60_000;

/*
 * ponytail: in-memory, so a restart re-notifies and a second instance
 * notifies twice. That is the right trade for one on-prem box — the failure
 * mode is a duplicate message, and the alternative is a shared store for the
 * sake of alert de-duplication. Move it to Redis if you ever run two.
 */
const lastSent = new Map<string, number>();

export function shouldSend(key: string, nowMs = Date.now()): boolean {
  const previous = lastSent.get(key);
  if (previous !== undefined && nowMs - previous < cooldownMs()) return false;
  lastSent.set(key, nowMs);
  return true;
}

/** Exposed so a test starts from silence rather than from another test's state. */
export const resetNotifications = () => lastSent.clear();

/**
 * Fire and forget. A webhook that is down must never take out the thing it
 * was reporting on — an agent run that placed an order and then threw because
 * Slack was unreachable is a worse outcome than an unsent message.
 */
export async function notify(event: NotifyEvent): Promise<boolean> {
  const url = webhook();
  if (!url) return false;
  if (!shouldSend(event.key ?? event.kind)) return false;

  const text = `[Foreman] ${event.title}\n${event.detail}${event.url ? `\n${event.url}` : ""}`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      /* `text` and `content` carry the same string because the two most
         likely destinations disagree about the name and neither tolerates
         the other's: Slack (and Google Chat, Mattermost, Teams) reads `text`,
         Discord reads `content` and rejects a body without it as an empty
         message. Sending both costs one duplicated line and removes the
         "which chat app is this" question from deployment entirely. */
      body: JSON.stringify({ ...event, text, content: text }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn(`[foreman] notify ${event.kind}: ${res.status}`);
    return res.ok;
  } catch (e) {
    console.warn(`[foreman] notify ${event.kind}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
