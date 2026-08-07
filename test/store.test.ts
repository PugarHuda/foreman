import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { claim, push, release, resetStore, storeKind, tail } from "../lib/store.ts";

describe("the shared store", () => {
  const prior = { url: process.env.REDIS_REST_URL, token: process.env.REDIS_REST_TOKEN };

  beforeEach(() => {
    delete process.env.REDIS_REST_URL;
    delete process.env.REDIS_REST_TOKEN;
    resetStore();
  });
  afterEach(() => {
    if (prior.url === undefined) delete process.env.REDIS_REST_URL;
    else process.env.REDIS_REST_URL = prior.url;
    if (prior.token === undefined) delete process.env.REDIS_REST_TOKEN;
    else process.env.REDIS_REST_TOKEN = prior.token;
  });

  it("stays in memory until both halves of a store are configured", () => {
    assert.equal(storeKind(), "memory");
    process.env.REDIS_REST_URL = "https://example.upstash.io";
    assert.equal(storeKind(), "memory", "a url with no token is not a store");
    process.env.REDIS_REST_TOKEN = "t";
    assert.equal(storeKind(), "redis");
  });

  /* This is the whole primitive. A cooldown is a claim nobody releases and a
     lock is a claim somebody does, so both are correct only if exactly one
     caller can win. */
  it("lets exactly one caller take a key", async () => {
    assert.equal(await claim("k", 60), true);
    assert.equal(await claim("k", 60), false);
  });

  it("frees the key when it is released", async () => {
    await claim("lock", 60);
    await release("lock");
    assert.equal(await claim("lock", 60), true, "a released lock must be takeable again");
  });

  /* A run that crashes without releasing must not lock the line out for the
     rest of the shift, which is what the lease is for. */
  it("frees the key when its lease runs out", async () => {
    const now = Date.now();
    assert.equal(await claim("lease", 60, now), true);
    assert.equal(await claim("lease", 60, now + 59_000), false);
    assert.equal(await claim("lease", 60, now + 61_000), true);
  });

  it("keeps separate keys separate", async () => {
    await claim("stale:CNC-07", 60);
    assert.equal(await claim("stale:PRESS-02", 60), true);
  });

  it("returns a list newest first, which is how anyone reads a journal", async () => {
    await push("runs", "one");
    await push("runs", "two");
    await push("runs", "three");

    assert.deepEqual(await tail("runs", 2), ["three", "two"]);
  });

  it("has nothing to say about a list nobody has written to", async () => {
    assert.deepEqual(await tail("empty", 10), []);
  });

  it("trims a list rather than growing it without bound", async () => {
    for (let i = 0; i < 12; i++) await push("capped", String(i), 5);
    const out = await tail("capped", 100);

    assert.equal(out.length, 5);
    assert.equal(out[0], "11", "the newest must survive the trim");
  });

  /* A store that is down must not stop the plant. Failing open costs a
     duplicate notification, or at worst a second agent run that the on-chain
     AlreadyOnOrder rejects. Failing closed would mean no assessment at all
     because a cache blinked. */
  it("fails open when the store cannot be reached", async () => {
    process.env.REDIS_REST_URL = "http://127.0.0.1:1";
    process.env.REDIS_REST_TOKEN = "t";

    assert.equal(await claim("anything", 60), true);
  });

  it("reports an unreachable store as empty rather than throwing", async () => {
    process.env.REDIS_REST_URL = "http://127.0.0.1:1";
    process.env.REDIS_REST_TOKEN = "t";

    assert.deepEqual(await tail("runs", 10), []);
  });
});
