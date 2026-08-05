"use client";

import { useEffect } from "react";

/**
 * A render crash on a control-room panel must not become a white screen. It
 * says what broke, and offers the one action that usually helps.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("dashboard crashed:", error);
  }, [error]);

  return (
    <main className="shell">
      <header className="masthead">
        <span className="wordmark">Foreman</span>
        <span className="tagline">Something went wrong rendering the line.</span>
      </header>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="body">
          <p className="detail" style={{ marginTop: 0 }}>
            The panel stopped. Machine telemetry and every purchase order are held on
            chain, so nothing here has been lost — this is the view failing, not the
            plant.
          </p>
          <p className="error" style={{ marginTop: 12 }}>
            {error.message}
            {error.digest ? `\n\ndigest ${error.digest}` : ""}
          </p>
          <div className="actions" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={reset}>
              Try again
            </button>
            <a className="btn" href="/">
              Reload the panel
            </a>
          </div>
        </div>
      </section>
    </main>
  );
}
