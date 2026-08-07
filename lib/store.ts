/**
 * The small amount of state that has to outlive one process.
 *
 * Three things needed it and each had grown its own in-memory version with a
 * `ponytail:` comment admitting the ceiling: the notification cooldown, the
 * one-run-at-a-time agent lock, and the journal. On a single on-prem box
 * memory and a disk are correct. On serverless every cold start forgets, so
 * the cooldown stops damping, two instances can both decide no run is in
 * flight, and the journal writes to a filesystem that is discarded.
 *
 * One store fixes all three, so there is one thing to configure and one thing
 * to be down rather than three.
 *
 *   memory  (default) what was there before — correct for one process
 *   redis             Upstash's REST API
 *
 * ponytail: Upstash over HTTP rather than a Redis client, because it is a
 * fetch and a token and this repo does not need a connection pool for three
 * keys. Any Redis with a REST proxy in front works; a real client is the
 * upgrade if you ever put a queue through here.
 */
export type StoreKind = "memory" | "redis";

const url = () => process.env.REDIS_REST_URL?.replace(/\/$/, "");
const token = () => process.env.REDIS_REST_TOKEN;

export const storeKind = (): StoreKind => (url() && token() ? "redis" : "memory");

/* The in-memory fallback. Entries carry their own expiry rather than being
   swept: there are a handful of keys, and a timer that has to be cleaned up
   is more to get wrong than a comparison on read. */
const mem = new Map<string, { value: string; expires: number }>();
const lists = new Map<string, string[]>();

export const resetStore = () => {
  mem.clear();
  lists.clear();
};

async function redis(command: (string | number)[]): Promise<unknown> {
  const res = await fetch(`${url()}/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token()}`, "Content-Type": "application/json" },
    body: JSON.stringify(command),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`redis ${command[0]}: ${res.status}`);
  return (await res.json())?.result;
}

/**
 * Claim a key nobody else holds. True means you got it.
 *
 * This is the whole primitive: a cooldown is a claim you do not release, and
 * a lock is a claim you do. Both need it to be atomic, which is why it is not
 * a get-then-set.
 */
export async function claim(key: string, ttlSeconds: number, nowMs = Date.now()): Promise<boolean> {
  if (storeKind() === "redis") {
    try {
      return (await redis(["SET", key, "1", "NX", "EX", Math.max(1, Math.ceil(ttlSeconds))])) !== null;
    } catch (e) {
      /* A store that is down must not stop the plant. Failing open means a
         duplicate notification or, at worst, two agent runs — and the
         on-chain spend permission is the backstop for the second. Failing
         closed would mean no assessment at all because Redis blinked. */
      console.warn(`[foreman] store unavailable, proceeding: ${e instanceof Error ? e.message : e}`);
      return true;
    }
  }

  const hit = mem.get(key);
  if (hit && hit.expires > nowMs) return false;
  mem.set(key, { value: "1", expires: nowMs + ttlSeconds * 1000 });
  return true;
}

export async function release(key: string): Promise<void> {
  if (storeKind() === "redis") {
    await redis(["DEL", key]).catch(() => {});
    return;
  }
  mem.delete(key);
}

/** Append to a list, newest last, trimmed to `keep`. */
export async function push(list: string, value: string, keep = 5000): Promise<boolean> {
  if (storeKind() === "redis") {
    try {
      await redis(["RPUSH", list, value]);
      await redis(["LTRIM", list, -keep, -1]);
      return true;
    } catch (e) {
      console.warn(`[foreman] store push: ${e instanceof Error ? e.message : e}`);
      return false;
    }
  }
  const arr = lists.get(list) ?? [];
  arr.push(value);
  if (arr.length > keep) arr.splice(0, arr.length - keep);
  lists.set(list, arr);
  return true;
}

/** The newest `n` entries, newest first. */
export async function tail(list: string, n: number): Promise<string[]> {
  if (storeKind() === "redis") {
    try {
      const out = (await redis(["LRANGE", list, -n, -1])) as string[] | null;
      return (out ?? []).reverse();
    } catch {
      return [];
    }
  }
  return (lists.get(list) ?? []).slice(-n).reverse();
}
