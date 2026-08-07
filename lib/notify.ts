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
import { claim, resetStore } from "./store.ts";

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

/**
 * The cooldown is a claim nobody releases: hold the key for its duration and
 * whoever tries next is told no. Shared when a store is configured, so two
 * serverless instances do not each page the same person about the same
 * machine — which is exactly what happened before, because a cold start
 * forgets a Map.
 */
export function shouldSend(key: string, nowMs = Date.now()): Promise<boolean> {
  return claim(`notify:${key}`, cooldownMs() / 1000, nowMs);
}

/** Exposed so a test starts from silence rather than from another test's state. */
export const resetNotifications = () => resetStore();

/**
 * Fire and forget. A webhook that is down must never take out the thing it
 * was reporting on — an agent run that placed an order and then threw because
 * Slack was unreachable is a worse outcome than an unsent message.
 */
export async function notify(event: NotifyEvent): Promise<boolean> {
  const url = webhook();
  if (!url) return false;
  if (!(await shouldSend(event.key ?? event.kind))) return false;

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
         "which chat app is this" question from deployment entirely.

         NOTIFY_CHAT_ID is for Telegram, which needs a recipient as well as a
         message. It could ride in the query string of the webhook URL, and
         probably would work — but "the API seems to read parameters from both
         places at once" is not something to find out is false on the night an
         order needed approving. Put it in the body, where it is documented. */
      body: JSON.stringify({
        ...event,
        text,
        content: text,
        ...(process.env.NOTIFY_CHAT_ID ? { chat_id: process.env.NOTIFY_CHAT_ID } : {}),
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) console.warn(`[foreman] notify ${event.kind}: ${res.status}`);
    return res.ok;
  } catch (e) {
    console.warn(`[foreman] notify ${event.kind}: ${e instanceof Error ? e.message : e}`);
    return false;
  }
}
