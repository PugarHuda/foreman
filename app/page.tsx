import Image from "next/image";
import Link from "next/link";
import shot from "../docs/dashboard.png";

/* The same README still, imported straight out of docs/ rather than copied
   into public/ — one file, and record-demo.mjs keeps both in sync. */

const FOREMAN = "0xaf34fcad7034ce9f220e71946e4fdf399bc07ca9";
const USDC = "0xc4798b4385c4c0c22e3eeac9fb5efa560883d501";

/* The severity bands, laid out proportionally, exactly as the machine cards
   draw them. This is the only colour on the page: it means machine health
   here for the same reason it does in the control room. */
const BANDS = [
  { zone: "A", span: 28, color: "var(--zone-a)" },
  { zone: "B", span: 17, color: "var(--zone-b)" },
  { zone: "C", span: 26, color: "var(--zone-c)" },
  { zone: "D", span: 29, color: "var(--zone-d)" },
];

export default function Landing() {
  return (
    <div className="shell landing">
      <header className="masthead">
        <span className="wordmark">Foreman</span>
        <span className="tagline">Predictive maintenance that can settle its own invoice.</span>
        <Link className="btn primary" href="/dashboard">
          Open the control room
        </Link>
      </header>

      <section className="hero">
        <h1>
          The machine asks for its own spare part.
          <br />A human sets the limit, once.
        </h1>
        <p className="lede">
          Foreman watches vibration on a machining line, projects when a bearing will cross the ISO
          10816-3 <em>stop the machine</em> threshold, and — if the part is out of stock and no
          supplier lead time beats the failure — buys it. Payment settles into on-chain escrow
          against a spend permission the plant manager signed weeks earlier, and releases to the
          supplier on confirmed receipt.
        </p>
        <div className="actions">
          <Link className="btn primary" href="/dashboard">
            Open the control room
          </Link>
          <a className="btn" href="https://github.com/PugarHuda/foreman">
            Read the source
          </a>
          <a
            className="btn"
            href={`https://base-sepolia.blockscout.com/address/${FOREMAN}#code`}
          >
            Read the contract
          </a>
        </div>
        <p className="warn">
          The control room is wired to Base Sepolia and spends real testnet money on your behalf.
          That is deliberate: the agent key holds 0.002 ETH of gas, the permission caps it at $2,000
          a month, and nothing above $500 executes without a second key. A stranger hammering the
          button is bounded by the same contract the plant relies on.
        </p>
      </section>

      <div className="strip">
        <div>
          <div className="eyebrow">Agent budget</div>
          <div className="value">$2,000</div>
          <div className="sub">per rolling 30 days, enforced on chain</div>
        </div>
        <div>
          <div className="eyebrow">Signs alone up to</div>
          <div className="value">$500</div>
          <div className="sub">above this, a human approves</div>
        </div>
        <div>
          <div className="eyebrow">Failure horizon</div>
          <div className="value">72 h</div>
          <div className="sub">inside it, the agent may act</div>
        </div>
        <div>
          <div className="eyebrow">Settles in</div>
          <div className="value">USDC</div>
          <div className="sub">escrow on Base, released on receipt</div>
        </div>
      </div>

      <Image
        className="shot"
        src={shot}
        alt="The Foreman control room: machine health on the ISO 10816-3 severity rail, the projected Zone D crossing, the agent's live reasoning trace, and the on-chain order queue"
        placeholder="blur"
        priority
      />

      <section className="columns">
        <div className="panel">
          <header>
            <h2>Routine goes through</h2>
            <span className="eyebrow">no human</span>
          </header>
          <div className="body">
            <p>
              A $180 bearing, 58 hours of life left, zero on the shelf, a vetted supplier who can
              deliver in 36. The agent proposes and funds it in one transaction, because it is under
              the ceiling. The line never stops and nobody raised a requisition.
            </p>
          </div>
        </div>
        <div className="panel">
          <header>
            <h2>Exceptions stop and wait</h2>
            <span className="eyebrow">human</span>
          </header>
          <div className="body">
            <p>
              A $4,000 spindle is proposed and left there. No <code>Funded</code> event, no money
              moved, until a separate key approves it — and that approval bypasses the cap, because
              the cap bounds the agent, not the plant.
            </p>
          </div>
        </div>
      </section>

      <section className="panel">
        <header>
          <h2>How it decides</h2>
          <span className="eyebrow">ISO 10816-3 Class II</span>
        </header>
        <div className="body">
          <div className="rail">
            {BANDS.map((b) => (
              <i key={b.zone} className="lit" style={{ background: b.color }} />
            ))}
          </div>
          <div className="raillabels">
            <span>A good</span>
            <span>B acceptable</span>
            <span>C act soon</span>
            <span>D stop</span>
          </div>
          <ol className="how">
            <li>
              <b>Trend, not threshold.</b> Vibration RMS is fitted log-linearly to project the hour
              the machine crosses Zone D — a number of hours left, not a red light after the fact.
            </li>
            <li>
              <b>Then check the store.</b> On hand <em>plus already on order</em>, so the agent does
              not buy the same bearing twice while the first one is in transit.
            </li>
            <li>
              <b>Then the suppliers.</b>{" "}
              Quotes come off the vetted list with each supplier&apos;s
              delivered-on-time record read from the order book. One that cannot arrive before the
              failure is not a cheaper option, it is no option.
            </li>
            <li>
              <b>Then it commits, or it does not.</b> Under the ceiling it signs. Over it, or with
              no supplier fast enough, it says so and stops.
            </li>
          </ol>
          <p className="fine">
            Telemetry never leaves for a model provider that retains it — the agent runs on Venice
            AI, which does not store inference data.
          </p>
        </div>
      </section>

      <section className="panel">
        <header>
          <h2>What the contract will not let it do</h2>
          <span className="eyebrow">~250 lines</span>
        </header>
        <div className="body">
          <dl className="guarantees">
            <dt>Invent a payee</dt>
            <dd>
              Payment only reaches an allowlisted supplier. A hallucinated or injected address is
              rejected at the contract, not by a prompt.
            </dd>
            <dt>Re-buy what is already coming</dt>
            <dd>
              A second order for the same part on the same machine reverts with{" "}
              <code>AlreadyOnOrder</code>. A guarantee that lives only in application memory is not
              a guarantee.
            </dd>
            <dt>Overspend</dt>
            <dd>The 30-day cap is checked on chain on every autonomous fund.</dd>
            <dt>Release escrow on a bare click</dt>
            <dd>
              The supplier commits a despatch document hash with their own key, and receipt reverts
              unless goods-in submits a reference that matches.
            </dd>
          </dl>
        </div>
      </section>

      <section className="panel">
        <header>
          <h2>Live on Base Sepolia</h2>
          <span className="eyebrow">verified</span>
        </header>
        <div className="body">
          <p className="addr">
            <span>Foreman</span>
            <a href={`https://sepolia.basescan.org/address/${FOREMAN}`}>
              <code>{FOREMAN}</code>
            </a>
          </p>
          <p className="addr">
            <span>USDC (mock)</span>
            <a href={`https://sepolia.basescan.org/address/${USDC}`}>
              <code>{USDC}</code>
            </a>
          </p>
          <p className="fine">
            Both are verified, so the bytecode running on Base Sepolia can be checked against the
            source in the repo rather than taken on trust.
          </p>
        </div>
      </section>

      <footer className="foot">
        <Link className="btn primary" href="/dashboard">
          Open the control room
        </Link>
        <span>Industrial 5.0 — humans handle exceptions, machines handle routine.</span>
      </footer>
    </div>
  );
}
