/**
 * Plant floor -> Foreman.
 *
 * Reads vibration from whatever the plant already runs and posts it to
 * /api/telemetry. Runs on-prem, next to the machines; the app never opens a
 * connection into the plant network and never speaks a fieldbus protocol.
 *
 *   node scripts/telemetry-bridge.mjs --source mqtt
 *   node scripts/telemetry-bridge.mjs --source opcua
 *   node scripts/telemetry-bridge.mjs --source csv --file export.csv --tag CNC-07
 *
 * Config comes from .env (see .env.example). The protocol clients are
 * optional dependencies: install only the one your plant speaks.
 *
 *   npm i mqtt          # for --source mqtt
 *   npm i node-opcua    # for --source opcua
 *
 * ponytail: batches on a timer rather than posting per sample. A 10 kHz
 * accelerometer is not what this reads — it reads the RMS a condition-
 * monitoring gateway has already computed, which arrives every few seconds at
 * most. If you genuinely need per-sample latency, the batch window is one
 * constant below.
 */
import fs from "node:fs";
import process from "node:process";

const env = fs.existsSync(".env")
  ? Object.fromEntries(
      fs
        .readFileSync(".env", "utf8")
        .split(/\r?\n/)
        .filter((l) => l.includes("=") && !l.trimStart().startsWith("#"))
        .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim()]),
    )
  : {};

const cfg = (k, fallback) => process.env[k] ?? env[k] ?? fallback;

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const BASE = cfg("FOREMAN_URL", "http://localhost:3000").replace(/\/$/, "");
const TOKEN = cfg("TELEMETRY_TOKEN");
const BATCH_MS = Number(cfg("TELEMETRY_BATCH_MS", "5000"));

if (!TOKEN) {
  console.error("TELEMETRY_TOKEN is missing. Set it in .env, and the same value on the app.");
  process.exit(1);
}

/* Buffered per tag and flushed on a timer, so a gateway publishing every
   second does not become a request every second — and so a Foreman that is
   briefly down costs a retry rather than the readings. */
const pending = new Map();

function queue(tag, at, rms) {
  if (!Number.isFinite(rms)) return;
  if (!pending.has(tag)) pending.set(tag, []);
  pending.get(tag).push({ at, rms });
}

async function flush() {
  for (const [tag, readings] of [...pending.entries()]) {
    if (readings.length === 0) continue;
    pending.set(tag, []);
    try {
      const res = await fetch(`${BASE}/api/telemetry`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
        body: JSON.stringify({ tag, readings }),
      });
      if (!res.ok) throw new Error(`${res.status} ${(await res.text()).slice(0, 200)}`);
      console.log(`${tag}: sent ${readings.length}`);
    } catch (e) {
      // Put them back rather than dropping them: a plant that loses an hour of
      // telemetry loses the trend, and the trend is the whole product.
      pending.get(tag).unshift(...readings);
      console.error(`${tag}: ${e.message} — ${pending.get(tag).length} queued`);
    }
  }
}

async function need(pkg, why) {
  try {
    return await import(pkg);
  } catch {
    console.error(`${pkg} is not installed. ${why}\n\n  npm i ${pkg}\n`);
    process.exit(1);
  }
}

// --- sources ---

/** MQTT_TOPICS maps topic -> machine tag: "plant/cnc07/rms=CNC-07,plant/press02/rms=PRESS-02" */
async function fromMqtt() {
  const { default: mqtt } = await need("mqtt", "It is the client for --source mqtt.");
  const url = cfg("MQTT_URL", "mqtt://localhost:1883");
  const map = new Map(
    (cfg("MQTT_TOPICS", "") || "")
      .split(",")
      .filter(Boolean)
      .map((pair) => pair.split("=").map((s) => s.trim())),
  );
  if (map.size === 0) {
    console.error('MQTT_TOPICS is empty. Example: MQTT_TOPICS=plant/cnc07/rms=CNC-07');
    process.exit(1);
  }

  const client = mqtt.connect(url, {
    username: cfg("MQTT_USERNAME") || undefined,
    password: cfg("MQTT_PASSWORD") || undefined,
    reconnectPeriod: 5000,
  });

  client.on("connect", () => {
    console.log(`mqtt ${url} connected`);
    for (const topic of map.keys()) client.subscribe(topic);
  });
  client.on("error", (e) => console.error(`mqtt: ${e.message}`));

  client.on("message", (topic, payload) => {
    const tag = map.get(topic);
    if (!tag) return;
    const text = payload.toString().trim();
    // Accept a bare number or a JSON object — gateways do both, and which one
    // is not worth a config flag.
    let rms;
    let at = Date.now();
    if (text.startsWith("{")) {
      try {
        const o = JSON.parse(text);
        rms = Number(o.rms ?? o.value ?? o.v);
        if (o.at ?? o.timestamp) at = o.at ?? o.timestamp;
      } catch {
        return;
      }
    } else {
      rms = Number(text);
    }
    queue(tag, at, rms);
  });
}

/** OPCUA_NODES maps nodeId -> machine tag: "ns=2;s=CNC07.RMS=CNC-07" */
async function fromOpcua() {
  const opcua = await need("node-opcua", "It is the client for --source opcua.");
  const url = cfg("OPCUA_URL", "opc.tcp://localhost:4840");
  const pairs = (cfg("OPCUA_NODES", "") || "")
    .split(",")
    .filter(Boolean)
    // Split on the LAST '=' — an OPC-UA node id contains its own.
    .map((s) => {
      const i = s.lastIndexOf("=");
      return [s.slice(0, i).trim(), s.slice(i + 1).trim()];
    });
  if (pairs.length === 0) {
    console.error('OPCUA_NODES is empty. Example: OPCUA_NODES=ns=2;s=CNC07.RMS=CNC-07');
    process.exit(1);
  }

  const client = opcua.OPCUAClient.create({ endpointMustExist: false });
  await client.connect(url);
  const session = await client.createSession();
  console.log(`opcua ${url} connected`);

  const sub = await session.createSubscription2({
    requestedPublishingInterval: Number(cfg("OPCUA_INTERVAL_MS", "1000")),
    publishingEnabled: true,
  });

  for (const [nodeId, tag] of pairs) {
    const item = await sub.monitor(
      { nodeId, attributeId: opcua.AttributeIds.Value },
      { samplingInterval: Number(cfg("OPCUA_INTERVAL_MS", "1000")), queueSize: 10, discardOldest: true },
      opcua.TimestampsToReturn.Both,
    );
    item.on("changed", (v) => {
      const at = v.sourceTimestamp ? new Date(v.sourceTimestamp).getTime() : Date.now();
      queue(tag, at, Number(v.value.value));
    });
    console.log(`  watching ${nodeId} -> ${tag}`);
  }

  const close = async () => {
    await session.close().catch(() => {});
    await client.disconnect().catch(() => {});
    process.exit(0);
  };
  process.on("SIGINT", close);
}

/** A historian export, posted once and then done. */
async function fromCsv() {
  const file = arg("file");
  const tag = arg("tag");
  if (!file || !tag) {
    console.error("--source csv needs --file <path> and --tag <machine tag>");
    process.exit(1);
  }

  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).filter((l) => l.trim() !== "");
  const head = lines[0].split(",").map((h) => h.trim().toLowerCase());
  const hasHeader = head.some((h) => Number.isNaN(Number(h)) && h !== "");
  let sent = 0;

  for (const line of lines.slice(hasHeader ? 1 : 0)) {
    const [t, v] = line.split(",");
    const at = Number.isFinite(Number(t)) ? Number(t) : Date.parse(t);
    queue(tag, at, Number(v));
    sent++;
  }

  console.log(`${file}: ${sent} rows`);
  await flush();
  process.exit(pending.get(tag)?.length ? 1 : 0);
}

// --- main ---

const source = arg("source", "mqtt");
console.log(`bridge -> ${BASE}/api/telemetry  (source: ${source})`);

if (source === "csv") {
  await fromCsv();
} else {
  if (source === "mqtt") await fromMqtt();
  else if (source === "opcua") await fromOpcua();
  else {
    console.error(`unknown --source ${source}. Expected mqtt, opcua or csv.`);
    process.exit(1);
  }
  setInterval(flush, BATCH_MS);
}
