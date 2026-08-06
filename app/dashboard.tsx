"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/** Models reach for markdown even when told not to. Strip it rather than
    render literal asterisks at a judge. */
function plain(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/* Band widths are the ISO 10816-3 Class II boundaries laid out proportionally.
   The same scale drives the rail on each machine card and the y-axis of the
   trend chart, so both read as one instrument. */
const BANDS = [
  { zone: "A", to: 2.8, span: 28, color: "var(--zone-a)" },
  { zone: "B", to: 4.5, span: 17, color: "var(--zone-b)" },
  { zone: "C", to: 7.1, span: 26, color: "var(--zone-c)" },
  { zone: "D", to: 10.0, span: 29, color: "var(--zone-d)" },
];
const ZONE_D = 7.1;

/** RMS (mm/s) -> 0..100 position along the severity scale. */
function scalePos(rms: number): number {
  let base = 0;
  let from = 0;
  for (const b of BANDS) {
    if (rms <= b.to || b.zone === "D") {
      const t = Math.min(1, (rms - from) / (b.to - from));
      return base + t * b.span;
    }
    base += b.span;
    from = b.to;
  }
  return 100;
}

/* Present only when the demo is deployed somewhere public — see lib/guard.ts. */
const POST_HEADERS: Record<string, string> = {
  "Content-Type": "application/json",
  ...(process.env.NEXT_PUBLIC_DEMO_SECRET
    ? { "x-demo-secret": process.env.NEXT_PUBLIC_DEMO_SECRET }
    : {}),
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

/** An unreadable figure is a dash, never a confident zero. */
const cash = (n: number | undefined | null) => (n == null ? "—" : money(n));

/**
 * Nothing waits forever. Without this a dropped connection leaves the button
 * reading "Working…" with no way back except a reload, which is not something
 * you want to discover in front of an audience.
 */
async function post(url: string, body: unknown, seconds: number) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), seconds * 1000);
  try {
    return await fetch(url, {
      method: "POST",
      headers: POST_HEADERS,
      body: JSON.stringify(body),
      signal: abort.signal,
    });
  } catch (e) {
    if (abort.signal.aborted) {
      throw new Error(
        `No answer after ${seconds}s. It may still be running — reload before trying again, so you do not order twice.`,
      );
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

interface Machine {
  id: number;
  tag: string;
  name: string;
  criticalPart: string;
  downtimeCostPerHour: number;
  stock: number;
  currentRms: number;
  zone: "A" | "B" | "C" | "D";
  rulHours: number | null;
  r2: number;
}

interface Sample {
  hours: number;
  rms: number;
}

interface PO {
  id: number;
  supplier: string;
  status: string;
  agentFunded: boolean;
  machineId: number;
  amountUsd: number;
  partNo: string;
  waybill: string | null;
}

interface Chain {
  foreman: string;
  agent: string;
  availableUsd: number;
  escrowedUsd: number;
  monthlyCapUsd: number;
  autoApproveMaxUsd: number;
  remainingBudgetUsd: number;
  pos: PO[];
}

interface Step {
  kind: "thought" | "tool" | "action";
  label: string;
  detail: string;
  txHash?: string;
}

interface State {
  hours: number;
  machineId: number;
  machines: Machine[];
  series: Sample[];
  quotes: { supplier: string; priceUsd: number; leadTimeHours: number }[];
  avoidedUsd: number;
  explorer: string;
  chain: Chain | null;
  chainError: string | null;
}

/** So a demo can be linked at the interesting moment, not just described. */
function fromUrl(key: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const v = Number(new URLSearchParams(window.location.search).get(key));
  return Number.isFinite(v) && v !== 0 ? v : fallback;
}

export default function Dashboard() {
  const [hours, setHours] = useState(() => fromUrl("hours", 300));
  const [machineId, setMachineId] = useState(() => fromUrl("machine", 7));
  const [data, setData] = useState<State | null>(null);
  const [steps, setSteps] = useState<Step[]>([]);
  const [summary, setSummary] = useState("");
  /** The slider can move after a run; the log has to say what it looked at. */
  const [ranAtHour, setRanAtHour] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** Kept apart from action errors so neither wipes the other off screen. */
  const [loadError, setLoadError] = useState<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  /* The order actually being placed is the last step, and it is the one worth
     watching. Keep it in view instead of letting it scroll out of the box. */
  useEffect(() => {
    const el = logRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [steps]);

  /**
   * A dashboard of zeros is the worst way to fail: it reads as a plant with
   * no money rather than a page that could not load. Any failure here has to
   * say so out loud.
   */
  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/state?hours=${hours}&machine=${machineId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`the plant view returned HTTP ${res.status}`);

      const json = await res.json().catch(() => {
        throw new Error("the plant view returned something unreadable");
      });
      if (!Array.isArray(json.machines)) throw new Error("the plant view is missing its machines");

      setData(json);
      setLoadError(null);
    } catch (e) {
      setLoadError(
        `Cannot read the line — ${e instanceof Error ? e.message : String(e)}. The figures below are not live.`,
      );
    }
  }, [hours, machineId]);

  /* Public RPC reads lag a confirmed write by a few seconds. Reading once
     straight after an action shows the old balance, which reads as a bug
     rather than latency — so read again shortly after. */
  const reload = useCallback(async () => {
    await load();
    setTimeout(load, 3000);
  }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAgent() {
    setBusy("agent");
    setError(null);
    setSteps([]);
    setSummary("");
    try {
      const res = await post("/api/agent", { hours }, 150);
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      setSteps(out.steps);
      setSummary(out.summary);
      setRanAtHour(out.hours ?? hours);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function poAction(action: string, id: number) {
    setBusy(`${action}-${id}`);
    setError(null);
    try {
      const res = await post("/api/po", { action, id }, 90);
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      await reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  const chain = data?.chain ?? null;
  const selected = data?.machines.find((m) => m.id === machineId);
  const waiting = chain?.pos.filter((p) => p.status === "Proposed") ?? [];
  const open = chain?.pos.filter((p) => p.status !== "Proposed") ?? [];

  return (
    <main className="shell">
      <header className="masthead">
        <span className="wordmark">Foreman</span>
        <span className="tagline">
          The machine asks for its own spare part. A human sets the limit, once.
        </span>
        <label className="eyebrow" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          run hour {hours}
          <input
            type="range"
            min={240}
            max={340}
            step={4}
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            style={{ width: 150 }}
          />
        </label>
      </header>

      {loadError && <p className="error">{loadError}</p>}
      {data?.chainError && (
        <p className="error">
          {/rate limit|429|timeout/i.test(data.chainError)
            ? "The public RPC is rate limiting us, so the money figures above are not live. The orders themselves are safe on chain — wait a moment and reload."
            : "Contracts not reachable — check the deployment, or run node scripts/deploy.mjs."}
          {"\n\n"}
          {data.chainError.split("\n")[0]}
        </p>
      )}
      {error && <p className="error">{error}</p>}
      {!data && !loadError && <p className="empty">Reading the line…</p>}

      {/* When the chain cannot be read, these must not read as zero — a row of
          $0 says the plant is broke, which is a very different claim from
          "the figures could not be fetched". */}
      <section className="strip">
        <div>
          <div className="eyebrow">Plant treasury</div>
          <div className="value">{cash(chain?.availableUsd)}</div>
          <div className="sub">uncommitted USDC</div>
        </div>
        <div>
          <div className="eyebrow">In escrow</div>
          <div className="value">{cash(chain?.escrowedUsd)}</div>
          <div className="sub">committed to open orders</div>
        </div>
        <div>
          <div className="eyebrow">Agent budget left</div>
          <div className="value">{cash(chain?.remainingBudgetUsd)}</div>
          <div className="sub">
            {chain ? `of ${money(chain.monthlyCapUsd)} per 30 days` : "per 30 days"}
          </div>
        </div>
        <div>
          <div className="eyebrow">Signs alone up to</div>
          <div className="value">{cash(chain?.autoApproveMaxUsd)}</div>
          <div className="sub">above this, a human approves</div>
        </div>
        <div>
          <div className="eyebrow">Downtime bought back</div>
          <div className="value">{cash(chain ? data?.avoidedUsd : undefined)}</div>
          <div className="sub">from orders now in flight</div>
        </div>
      </section>

      <div className="columns">
        <div className="stack">
          <section className="panel">
            <header>
              <h2 style={{ fontSize: 13 }}>Line 3 — machining</h2>
              <span className="eyebrow">ISO 10816-3 class II</span>
            </header>
            <div className="machines">
              {data?.machines.map((m) => (
                <button
                  key={m.id}
                  className="machine"
                  aria-pressed={m.id === machineId}
                  onClick={() => setMachineId(m.id)}
                >
                  <div className="tag">{m.tag}</div>
                  <div className="name">{m.name}</div>
                  <div className="reading">
                    <span className="rms">{m.currentRms.toFixed(2)}</span>
                    <span className="unit">mm/s RMS</span>
                  </div>
                  <Rail rms={m.currentRms} />
                  <div className="rul">
                    {m.rulHours === null ? (
                      <>trend flat — no failure projected</>
                    ) : (
                      <>
                        zone D in <b>{m.rulHours} h</b> · {money(m.downtimeCostPerHour)}/h if it stops
                      </>
                    )}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <header>
              <h2 style={{ fontSize: 13 }}>{selected?.tag} vibration trend</h2>
              <span className="eyebrow">
                {selected?.criticalPart} · {selected?.stock ?? 0} on hand
              </span>
            </header>
            <div className="body">
              <Trend samples={data?.series ?? []} rulHours={selected?.rulHours ?? null} />
            </div>
          </section>

          <section className="panel">
            <header>
              <h2 style={{ fontSize: 13 }}>Approved suppliers for {selected?.criticalPart}</h2>
              <span className="eyebrow">vetted on chain</span>
            </header>
            <div className="body">
              {(data?.quotes.length ?? 0) === 0 && (
                <p className="empty">No vetted supplier carries this part.</p>
              )}
              {data?.quotes.map((q) => (
                <div className="po" key={q.supplier}>
                  <div className="line">
                    <span className="part">{q.supplier}</span>
                    <span className="amount">{money(q.priceUsd)}</span>
                  </div>
                  <div className="line">
                    <span className="meta">{q.leadTimeHours} h lead time</span>
                    <span className="meta">
                      {selected?.rulHours != null && q.leadTimeHours < selected.rulHours
                        ? "arrives before failure"
                        : "arrives late"}
                    </span>
                  </div>
                </div>
              ))}
              <p className="empty" style={{ borderTop: "1px solid var(--rule)", paddingTop: 10, marginTop: 4 }}>
                The agent may choose among these. It cannot pay anyone else — the
                contract rejects any address the plant has not vetted.
              </p>
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="panel">
            <header>
              <h2 style={{ fontSize: 13 }}>
                Agent
                {ranAtHour !== null && (
                  <span className="eyebrow" style={{ marginLeft: 8 }}>
                    assessed run hour {ranAtHour}
                    {ranAtHour !== hours ? " — the slider has moved since" : ""}
                  </span>
                )}
              </h2>
              <button className="btn primary" onClick={runAgent} disabled={busy !== null}>
                {busy === "agent" ? "Working…" : "Run agent"}
              </button>
            </header>
            <div className="body">
              {steps.length === 0 && !summary && (
                <p className="empty">
                  Nothing yet. Run the agent and it will read telemetry, price the part, and commit
                  funds if the machine needs it.
                </p>
              )}
              <div className="log" ref={logRef}>
                {steps.map((s, i) => (
                  <div key={i} className={`step ${s.kind}`}>
                    <span className="mark">
                      {s.kind === "tool" ? "→" : s.kind === "action" ? "◆" : "·"}
                    </span>
                    <div>
                      <div className="label">{s.label}</div>
                      {s.detail && <div className="detail">{plain(s.detail)}</div>}
                      {s.txHash && (
                        <a
                          className="detail"
                          href={`https://sepolia.basescan.org/tx/${s.txHash}`}
                          target="_blank"
                          rel="noreferrer"
                          style={{ display: "inline-block", marginTop: 4 }}
                        >
                          {s.txHash.slice(0, 18)}… ↗
                        </a>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              {summary && (
                <p className="detail" style={{ marginTop: 14, borderTop: "1px solid var(--rule)", paddingTop: 12 }}>
                  {plain(summary)}
                </p>
              )}
            </div>
          </section>

          <section className="panel">
            <header>
              <h2 style={{ fontSize: 13 }}>Waiting on you</h2>
              {waiting.length > 0 && <span className="badge wait">{waiting.length}</span>}
            </header>
            <div className="body">
              {waiting.length === 0 && <p className="empty">Nothing waiting on you.</p>}
              {waiting.map((po) => (
                <div className="po" key={po.id}>
                  <div className="line">
                    <span className="part">
                      {po.partNo} · machine {po.machineId}
                    </span>
                    <span className="amount">{money(po.amountUsd)}</span>
                  </div>
                  <div className="meta">
                    Over the {money(chain?.autoApproveMaxUsd ?? 0)} ceiling the agent may sign alone.
                  </div>
                  <div className="actions">
                    <button
                      className="btn primary"
                      disabled={busy !== null}
                      onClick={() => poAction("approve", po.id)}
                    >
                      {busy === `approve-${po.id}` ? "Approving…" : `Approve ${money(po.amountUsd)}`}
                    </button>
                    <button
                      className="btn"
                      disabled={busy !== null}
                      onClick={() => poAction("cancel", po.id)}
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <header>
              <h2 style={{ fontSize: 13 }}>Purchase orders</h2>
              {chain && data?.explorer ? (
                <a
                  className="eyebrow"
                  href={`${data.explorer}/address/${chain.foreman}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  on chain ↗
                </a>
              ) : (
                <span className="eyebrow">on chain</span>
              )}
            </header>
            <div className="body">
              {open.length === 0 && <p className="empty">No orders placed yet.</p>}
              {open.map((po) => (
                <div className="po" key={po.id}>
                  <div className="line">
                    <span className="part">
                      #{po.id} {po.partNo}
                    </span>
                    <span className="amount">{money(po.amountUsd)}</span>
                  </div>
                  <div className="line">
                    <span className="meta">
                      {po.agentFunded ? "signed by agent" : "approved by plant"}
                    </span>
                    <span className="badge">{po.status}</span>
                  </div>
                  {po.waybill && (
                    <div className="meta">
                      waybill {po.waybill} — committed on despatch, checked on arrival
                    </div>
                  )}
                  <div className="actions">
                    {po.status === "Funded" && (
                      <button
                        className="btn"
                        disabled={busy !== null}
                        onClick={() => poAction("ship", po.id)}
                      >
                        {busy === `ship-${po.id}` ? "…" : "Supplier ships"}
                      </button>
                    )}
                    {(po.status === "Funded" || po.status === "Shipped") && (
                      <button
                        className="btn primary"
                        disabled={busy !== null}
                        onClick={() => poAction("confirm", po.id)}
                      >
                        {busy === `confirm-${po.id}` ? "…" : "Confirm receipt & pay"}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

function Rail({ rms }: { rms: number }) {
  const pos = scalePos(rms);
  const active = BANDS.find((b) => rms <= b.to) ?? BANDS[3];
  return (
    <>
      <div className="rail">
        {BANDS.map((b) => (
          <i
            key={b.zone}
            className={b.zone === active.zone ? "lit" : ""}
            style={{ background: b.color }}
          />
        ))}
        <span className="needle" style={{ left: `${pos}%` }} />
      </div>
      <div className="raillabels">
        <span>A</span>
        <span>B</span>
        <span>C</span>
        <span>D stop</span>
      </div>
    </>
  );
}

function Trend({ samples, rulHours }: { samples: Sample[]; rulHours: number | null }) {
  const W = 820;
  const H = 240;
  if (samples.length < 2) return <p className="empty">No telemetry.</p>;

  const last = samples[samples.length - 1];

  /* A trailing window, not the whole run. Plotting 300 flat hours squeezes the
     fault growth — the only part anyone needs to see — into a sliver at the
     right edge. */
  const WINDOW_HOURS = 120;
  const xMin = Math.max(samples[0].hours, last.hours - WINDOW_HOURS);
  const xMax = last.hours + (rulHours ?? 24) * 1.25 + 5;
  const x = (h: number) => ((h - xMin) / (xMax - xMin)) * W;
  const y = (rms: number) => H - (scalePos(rms) / 100) * H;

  const visible = samples.filter((s) => s.hours >= xMin);
  // One point per ~3px is plenty; the rest is noise the eye cannot resolve.
  const stride = Math.max(1, Math.floor(visible.length / 260));
  const line = visible
    .filter((_, i) => i % stride === 0 || i === visible.length - 1)
    .map((s) => `${x(s.hours).toFixed(1)},${y(s.rms).toFixed(1)}`)
    .join(" ");

  const crossX = rulHours !== null ? x(last.hours + rulHours) : null;

  // Bands stack from the bottom: zone A sits at the floor, matching y().
  let base = 0;
  const bands = BANDS.map((b) => {
    const top = H - ((base + b.span) / 100) * H;
    base += b.span;
    return { ...b, top, height: (b.span / 100) * H };
  });

  return (
    /* No fixed height: the viewBox scales to the container width, and pinning
       240px on a phone left the plot squeezed into a third of a mostly empty
       box. */
    <svg viewBox={`0 0 ${W} ${H}`} style={{ display: "block", width: "100%", height: "auto" }} role="img"
      aria-label={`Vibration trend. Now ${last.rms.toFixed(2)} millimetres per second.${
        rulHours !== null ? ` Zone D projected in ${rulHours} hours.` : ""
      }`}>
      {bands.map((b) => (
        <g key={b.zone}>
          <rect x={0} y={b.top} width={W} height={b.height} fill={b.color} opacity={0.09} />
          <text x={6} y={b.top + 13} fill={b.color} fontSize={10} opacity={0.85}>
            {b.zone}
          </text>
        </g>
      ))}

      {crossX !== null && (
        <>
          <line
            x1={x(last.hours)}
            y1={y(last.rms)}
            x2={crossX}
            y2={y(ZONE_D)}
            stroke="var(--ink)"
            strokeWidth={1.5}
            strokeDasharray="5 4"
            opacity={0.75}
          />
          <line x1={crossX} y1={0} x2={crossX} y2={H} stroke="var(--zone-d)" strokeWidth={1} opacity={0.5} />
          <text
            x={Math.min(crossX + 8, W - 150)}
            y={18}
            fill="var(--zone-d)"
            fontSize={11}
            fontFamily="var(--font-mono)"
          >
            zone D · {rulHours} h
          </text>
        </>
      )}

      <text x={6} y={H - 6} fill="var(--dim)" fontSize={10} fontFamily="var(--font-mono)">
        run hour {Math.round(xMin)} → {Math.round(last.hours)}
      </text>

      <polyline points={line} fill="none" stroke="var(--ink)" strokeWidth={1.6} />
      <circle cx={x(last.hours)} cy={y(last.rms)} r={3.5} fill="var(--ink)" />
      <text
        x={Math.max(6, x(last.hours) - 120)}
        y={Math.max(14, y(last.rms) - 10)}
        fill="var(--ink)"
        fontSize={11}
        fontFamily="var(--font-mono)"
      >
        now {last.rms.toFixed(2)} mm/s
      </text>
    </svg>
  );
}
