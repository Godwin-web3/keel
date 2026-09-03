import type { RunState, WindowMarket } from "./lib/types";
import { ASSET_ICON, formatUsd } from "./lib/format";
import { findLiveWindow } from "./lib/instruments";

const STATUS_COPY: Record<RunState["status"], string> = {
  running: "Riding",
  cashed: "Cashed out",
  stopped: "Stopped",
  busted: "Busted",
  maxed: "Max rounds",
};

export default function RunCard({
  markets,
  signedIn,
  busy,
  run,
  stake,
  onStake,
  cashOutAt,
  onCashOutAt,
  stopAt,
  onStopAt,
  maxRounds,
  onMaxRounds,
  sameSide,
  onSameSide,
  asset,
  onAsset,
  onStart,
  onStop,
}: {
  markets: WindowMarket[];
  signedIn: boolean;
  busy: boolean;
  run: RunState | null;
  stake: number;
  onStake: (n: number) => void;
  cashOutAt: number;
  onCashOutAt: (n: number) => void;
  stopAt: number;
  onStopAt: (n: number) => void;
  maxRounds: number;
  onMaxRounds: (n: number) => void;
  sameSide: boolean;
  onSameSide: (v: boolean) => void;
  asset: "BTC" | "ETH";
  onAsset: (a: "BTC" | "ETH") => void;
  onStart: () => void;
  onStop: () => void;
}) {
  const live = findLiveWindow(markets, asset);
  const active = run?.status === "running";

  return (
    <section className="card run-card">
      <h2>Run</h2>
      <p className="muted" style={{ marginTop: -4, marginBottom: 14 }}>
        Repeat the next window until a limit you set. Cash out, stop, or max rounds — then it stops.
      </p>

      {run && (
        <div className={`run-status ${run.status}`}>
          <div className="run-status-head">
            <strong>{STATUS_COPY[run.status]}</strong>
            <span>
              {ASSET_ICON[run.asset]} {run.asset} · {run.timeframe} · round {run.hops.length}/{run.maxRounds}
            </span>
          </div>
          <div className="ticket-math">
            <div>
              <span>Started</span>
              {formatUsd(run.bankrollStart)}
            </div>
            <div>
              <span>Now</span>
              {formatUsd(run.bankrollNow)}
            </div>
            <div>
              <span>Peak</span>
              {formatUsd(run.peak)}
            </div>
          </div>
          {run.stopReason && <p className="muted">{run.stopReason}</p>}
          <ol className="run-hops">
            {run.hops.map((h, i) => (
              <li key={`${h.marketId}-${i}`}>
                <span>
                  #{i + 1} {h.asset} {h.side === "up" ? "Up" : "Down"} · ${formatUsd(h.stake)}
                </span>
                <span className={h.result ?? "pending"}>{h.result ?? "live"}</span>
              </li>
            ))}
          </ol>
          {active && (
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="ghost" disabled={busy} onClick={onStop}>
                Stop now — keep what's left
              </button>
            </div>
          )}
        </div>
      )}

      {!active && (
        <>
          <div className="run-grid">
            <label>
              Starting stake
              <input type="number" min={1} step={1} value={stake} onChange={(e) => onStake(Number(e.target.value))} />
            </label>
            <label>
              Cash out at
              <input type="number" min={1} step={1} value={cashOutAt} onChange={(e) => onCashOutAt(Number(e.target.value))} />
            </label>
            <label>
              Stop at
              <input type="number" min={0} step={1} value={stopAt} onChange={(e) => onStopAt(Number(e.target.value))} />
            </label>
            <label>
              Max rounds
              <input type="number" min={1} max={12} step={1} value={maxRounds} onChange={(e) => onMaxRounds(Number(e.target.value))} />
            </label>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className={asset === "BTC" ? "" : "ghost"} type="button" onClick={() => onAsset("BTC")}>
              BTC
            </button>
            <button className={asset === "ETH" ? "" : "ghost"} type="button" onClick={() => onAsset("ETH")}>
              ETH
            </button>
          </div>
          <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", margin: "12px 0" }}>
            <input type="checkbox" checked={sameSide} onChange={(e) => onSameSide(e.target.checked)} />
            Repeat the same side each window
          </label>
          <p className="muted">
            {live
              ? `First hop: ${live.asset} ${live.timeframe} live now.`
              : `No live ${asset} window right now.`}
          </p>
          <div className="actions" style={{ marginTop: 12 }}>
            <button disabled={busy || !signedIn || !live} onClick={onStart}>
              Start run
            </button>
          </div>
          {!signedIn && <p className="muted">Connect a wallet first.</p>}
        </>
      )}
    </section>
  );
}
