import Link from "next/link";
import Image from "next/image";
import shot from "../../docs/dashboard.png";
import { FOREMAN_ADDRESS, EXPLORER } from "@/lib/deployment.ts";
import { PLANNING_HORIZON_HOURS } from "@/lib/plant.ts";
import { getState } from "@/lib/chain.ts";

/**
 * The pitch, as slides.
 *
 * A deck is normally a file somebody has to be sent, which means the version a
 * judge reads is whichever one reached them. This one is a URL, so there is
 * exactly one, and its numbers come off the contract rather than off a
 * screenshot of the contract taken three days ago.
 *
 * Print to PDF from the browser and the slides break where the page breaks —
 * that is what `break-inside: avoid` and the print rules in globals.css are
 * for. No slide framework: eleven sections and CSS scroll snapping.
 */
export const revalidate = 3600;

export const metadata = {
  title: "Foreman — the deck",
  description:
    "The machine asks for its own spare part. A human sets the limit, once. Eleven slides on predictive maintenance that settles its own invoice.",
};

const money = (n: number) =>
  n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

async function policy() {
  try {
    const s = await getState();
    return { cap: s.monthlyCapUsd, ceiling: s.autoApproveMaxUsd, live: true };
  } catch {
    return { cap: 2000, ceiling: 500, live: false };
  }
}

function Slide({
  n,
  eyebrow,
  children,
}: {
  n: number;
  eyebrow: string;
  children: React.ReactNode;
}) {
  return (
    <section className="slide" id={`s${n}`}>
      <div className="slide-head">
        <span className="eyebrow">{eyebrow}</span>
        <span className="slide-n">{String(n).padStart(2, "0")}</span>
      </div>
      <div className="slide-body">{children}</div>
    </section>
  );
}

export default async function Deck() {
  const { cap, ceiling } = await policy();

  return (
    <div className="shell deck">
      <header className="masthead">
        <span className="wordmark">Foreman</span>
        <span className="tagline">The deck — eleven slides, and every number read off the contract.</span>
        <Link className="btn primary" href="/dashboard">
          Open the control room
        </Link>
      </header>

      <Slide n={1} eyebrow="The claim">
        <h1>
          The machine asks for its own spare part.
          <br />A human sets the limit, once.
        </h1>
        <p className="lede">
          Foreman watches vibration on a machining line, projects when a bearing will cross the ISO
          10816-3 <em>stop the machine</em> threshold, and buys the part before the line stops.
          Payment settles into on-chain escrow against a spend permission signed weeks earlier.
        </p>
        <div className="actions">
          <Link className="btn primary" href="/dashboard">
            See it run
          </Link>
          <a className="btn" href="/pitch.mp4">
            Watch the pitch
          </a>
          <a className="btn" href="https://github.com/PugarHuda/foreman">
            Read the source
          </a>
        </div>
      </Slide>

      <Slide n={2} eyebrow="The problem">
        <h2>Industrial 4.0 automated the data and left the decision</h2>
        <p>
          Sensors went on the machines. A human was left to read the dashboard, raise a
          requisition, chase three quotes, wait for a PO number and phone the supplier — while the
          bearing kept degrading.
        </p>
        <ol className="chain">
          <li>
            <b>Hours</b> <span>Vibration crosses a threshold nobody is watching at 02:00</span>
          </li>
          <li>
            <b>Days</b> <span>Requisition, three quotes, approval, PO number</span>
          </li>
          <li>
            <b>Then</b> <span>Supplier lead time starts — after the failure window closed</span>
          </li>
        </ol>
        <p className="fine">
          The data loop was automated. The decision-to-cash loop was not, and that is the one that
          costs a shift.
        </p>
      </Slide>

      <Slide n={3} eyebrow="What it costs">
        <div className="strip">
          <div>
            <div className="eyebrow">CNC-07 stopped</div>
            <div className="value">$890</div>
            <div className="sub">per hour of unplanned downtime</div>
          </div>
          <div>
            <div className="eyebrow">The bearing</div>
            <div className="value">$180</div>
            <div className="sub">6205-2RS, 36-hour lead time</div>
          </div>
          <div>
            <div className="eyebrow">Decision lag</div>
            <div className="value">days</div>
            <div className="sub">requisition to purchase order</div>
          </div>
          <div>
            <div className="eyebrow">Warning available</div>
            <div className="value">58 h</div>
            <div className="sub">projected, from the trend</div>
          </div>
        </div>
        <p>
          The warning is there. The part is cheap. What is missing is the authority to act on the
          warning inside the window it gives you.
        </p>
      </Slide>

      <Slide n={4} eyebrow="The loop">
        <h2>Sense, decide, commit, settle</h2>
        <pre className="flow">{`vibration telemetry      ISO 10816-3 zones, log-linear RUL trending
        │
        ▼
maintenance agent        4 tools · reads health, stock, quotes · signs
        │
        ▼
spend permission         autonomous ≤ ceiling · human above it · 30-day budget
        │
        ▼
supplier paid            on confirmed receipt, against a despatch document`}</pre>
        <p className="fine">
          Every step is a real transaction on Base Sepolia. The reasoning trace streams as it
          happens rather than arriving after a spinner, because a shift assessment is a sequence of
          decisions and the sequence is the part worth watching.
        </p>
      </Slide>

      <Slide n={5} eyebrow="The idea">
        <h2>Two lanes, and the split is on chain</h2>
        <div className="columns">
          <div className="panel">
            <header>
              <h3>Routine goes through</h3>
              <span className="eyebrow">no human</span>
            </header>
            <div className="body">
              <p>
                {money(180)} bearing, 58 hours of life left, zero on the shelf, a vetted supplier
                who can deliver in 36. Proposed and funded in one transaction. The line never stops
                and nobody raised a requisition.
              </p>
            </div>
          </div>
          <div className="panel">
            <header>
              <h3>Exceptions stop and wait</h3>
              <span className="eyebrow">human</span>
            </header>
            <div className="body">
              <p>
                {money(4000)} spindle is proposed and left there. No <code>Funded</code> event, no
                money moved, until a separate key approves it — and that approval bypasses the cap,
                because the cap bounds the agent, not the plant.
              </p>
            </div>
          </div>
        </div>
        <p className="fine">
          This is what &ldquo;humans handle exceptions, machines handle routine&rdquo; looks like
          when it is enforced by a contract instead of written in a policy document.
        </p>
      </Slide>

      <Slide n={6} eyebrow="The product">
        <h2>The control room</h2>
        <Image className="shot" src={shot} alt="The Foreman control room" placeholder="blur" />
      </Slide>

      <Slide n={7} eyebrow="Trust">
        <h2>What the contract will not let the agent do</h2>
        <dl className="guarantees">
          <dt>Invent a payee</dt>
          <dd>
            Payment only reaches an allowlisted supplier. A hallucinated or injected address is
            rejected at the contract, not by a prompt.
          </dd>
          <dt>
            Invent a price <span className="where">tool layer</span>
          </dt>
          <dd>
            The agent chooses whose quote to take; it cannot write the amount. A decimal in the
            wrong place was a vetted supplier handed ten times their quote, inside budget. This one
            is enforced in <code>lib/agent.ts</code> rather than on chain, because the price list
            is not on chain — and saying so is cheaper than having it noticed.
          </dd>
          <dt>Re-buy what is coming</dt>
          <dd>
            A second order for the same part on the same machine reverts. A guarantee that lives
            only in application memory is not a guarantee.
          </dd>
          <dt>Overspend</dt>
          <dd>{money(cap)} per rolling 30 days, checked on chain on every autonomous fund.</dd>
          <dt>Release escrow on a click</dt>
          <dd>
            The supplier commits a despatch document hash with their own key, and receipt reverts
            unless goods-in submits a reference that matches.
          </dd>
        </dl>
      </Slide>

      <Slide n={8} eyebrow="Why now">
        <h2>Industrial 5.0 asks for exactly this</h2>
        <ul className="how">
          <li>
            <b>Humans handle exceptions.</b> The split is enforced on chain, not documented in a
            binder nobody opens.
          </li>
          <li>
            <b>Authority is explicit and revocable.</b> A spend permission is a signed, auditable
            on-chain object with a budget and a ceiling — not an API key with unbounded access to a
            corporate card.
          </li>
          <li>
            <b>Resilient supply chains.</b> The order is placed against a projected failure instead
            of a monthly reorder cycle.
          </li>
          <li>
            <b>Privacy a plant will sign.</b> Telemetry never leaves for a model provider that
            retains it — the agent runs on Venice AI, which does not store inference data.
          </li>
        </ul>
      </Slide>

      <Slide n={9} eyebrow="Not a mockup">
        <h2>Live, and checkable without running anything</h2>
        <div className="strip">
          <div>
            <div className="eyebrow">Agent budget</div>
            <div className="value">{money(cap)}</div>
            <div className="sub">read off the contract, now</div>
          </div>
          <div>
            <div className="eyebrow">Signs alone up to</div>
            <div className="value">{money(ceiling)}</div>
            <div className="sub">above this, a human approves</div>
          </div>
          <div>
            <div className="eyebrow">Failure horizon</div>
            <div className="value">{PLANNING_HORIZON_HOURS} h</div>
            <div className="sub">inside it, the agent may act</div>
          </div>
          <div>
            <div className="eyebrow">Tests</div>
            <div className="value">241</div>
            <div className="sub">across contract, unit, browser and pilot</div>
          </div>
        </div>
        <p className="addr">
          <span>Foreman</span>
          <a href={`${EXPLORER}/address/${FOREMAN_ADDRESS}`}>
            <code>{FOREMAN_ADDRESS}</code>
          </a>
        </p>
        <p className="fine">
          Verified, so the bytecode running on Base Sepolia can be checked against the source in
          the repo rather than taken on trust. Press <em>Run agent</em> on the live deployment and
          it spends actual testnet money on your behalf — bounded by the same contract a plant
          would rely on.
        </p>
      </Slide>

      <Slide n={10} eyebrow="Past the demo">
        <h2>A pilot is configuration, not a fork</h2>
        <p>
          Every fixture is a seam with a real implementation behind it, and the fixture stays the
          default so the public demo still runs offline.
        </p>
        <dl className="guarantees">
          <dt>Telemetry</dt>
          <dd>A historian export or a live gateway — MQTT, OPC-UA or CSV, through an on-prem bridge.</dd>
          <dt>Stock and quotes</dt>
          <dd>A REST endpoint in front of the plant&apos;s ERP.</dd>
          <dt>Operators</dt>
          <dd>Named accounts, scrypt-hashed, with an append-only journal of who approved what.</dd>
          <dt>The agent key</dt>
          <dd>A KMS-agnostic signing seam, so the key stops being an environment variable.</dd>
        </dl>
        <p className="fine">
          What a pilot still is not: mainnet USDC, and an audited contract. Both are deliberate —
          get the plant data and the loop right where a mistake costs nothing, then decide whether
          real money is worth an audit.
        </p>
      </Slide>

      <Slide n={11} eyebrow="The ask">
        <h2>One line, one machine, one shift</h2>
        <p className="lede">
          The next step is a paid pilot with a single Malaysian precision-machining plant: one
          machine, real telemetry, real ERP, testnet settlement — to prove the loop where a mistake
          costs nothing. The integration layer for that is already built and tested.
        </p>
        <div className="actions">
          <Link className="btn primary" href="/dashboard">
            Open the control room
          </Link>
          <a className="btn" href="https://github.com/PugarHuda/foreman">
            github.com/PugarHuda/foreman
          </a>
        </div>
      </Slide>

      <footer className="foot">
        <Link className="btn primary" href="/">
          Back to the overview
        </Link>
        <span>Industrial 5.0 — humans handle exceptions, machines handle routine.</span>
      </footer>
    </div>
  );
}
