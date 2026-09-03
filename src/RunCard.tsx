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
  coin,
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
  coin: string;
}) {
  const live = findLiveWindow(markets, asset);
  const active = run?.status === "running";

  return (
    <section className="card run-card">
      <h2>Run</h2>
      <p className="muted" style={{ marginTop: -4, marginBottom: 14 }}>
        Keep betting on the next round until you hit a limit. Then it stops for you.
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
              {formatUsd(run.bankrollStart)} {coin}
            </div>
            <div>
              <span>Now</span>
              {formatUsd(run.bankrollNow)} {coin}
            </div>
            <div>
              <span>Best</span>
              {formatUsd(run.peak)} {coin}
            </div>
          </div>
          {run.stopReason && <p className="muted">{run.stopReason}</p>}
          <ol className="run-hops">
            {run.hops.map((h, i) => (
              <li key={`${h.marketId}-${i}`}>
                <span>
                  #{i + 1} {h.asset} {h.side === "up" ? "Up" : "Down"} · {formatUsd(h.stake)} {coin}
                </span>
                <span className={h.result ?? "pending"}>{h.result ?? "live"}</span>
              </li>
            ))}
          </ol>
          {active && (
            <div className="actions" style={{ marginTop: 12 }}>
              <button className="ghost" disabled={busy} onClick={onStop}>
                Stop and keep what's left
              </button>
            </div>
          )}
        </div>
      )}

      {!active && (
        <>
          <div className="run-grid">
            <label>
              Starting amount ({coin})
              <input type="number" min={1} step={1} value={stake} onChange={(e) => onStake(Number(e.target.value))} />
            </label>
            <label>
              Cash out at ({coin})
              <input type="number" min={1} step={1} value={cashOutAt} onChange={(e) => onCashOutAt(Number(e.target.value))} />
            </label>
            <label>
              Stop if I drop to ({coin})
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
            Repeat Up or Down each round
          </label>
          <p className="muted">
            {live
              ? `${live.asset} is live now.`
              : `No live ${asset} market right now.`}
          </p>
          <div className="actions" style={{ marginTop: 12 }}>
            <button disabled={busy || !signedIn || !live} onClick={onStart}>
              Start run
            </button>
          </div>
          {!signedIn && <p className="muted">Connect your wallet first.</p>}
        </>
      )}
    </section>
  );
}
