import { useEffect, useMemo, useState } from "react";
import type { JournalRow, NetworkName, Side, WindowMarket } from "./lib/types";
import { formatCountdown, formatProb, formatUsd, plainLanguage, quoteTicket, shorten, STATUS_LABEL } from "./lib/format";
import { appendJournal, loadJournal } from "./lib/journal";
import { connectExchange, derivePositions, disconnectExchange, listWindows, maskKey, placeStake, redeemMarket } from "./lib/sdk";

type Tab = "markets" | "desk";

const DEFAULT_STAKE = 10;

export default function App() {
  const [tab, setTab] = useState<Tab>("markets");
  const [network, setNetwork] = useState<NetworkName>("shannon");
  const [privateKey, setPrivateKey] = useState("");
  const [connected, setConnected] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [markets, setMarkets] = useState<WindowMarket[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [stake, setStake] = useState(DEFAULT_STAKE);
  const [journal, setJournal] = useState<JournalRow[]>([]);
  const [rollAfterRedeem, setRollAfterRedeem] = useState(true);

  useEffect(() => {
    setJournal(loadJournal());
  }, []);

  const selected = markets.find((m) => m.marketId === selectedId) ?? markets[0] ?? null;
  const quote = selected ? quoteTicket("up", stake, selected.impliedUp) : null;
  const { open, claimable } = useMemo(() => derivePositions(markets, journal), [markets, journal]);

  async function refresh() {
    setBusy(true);
    setMessage(null);
    try {
      const rows = await listWindows();
      setMarkets(rows);
      if (!selectedId && rows[0]) setSelectedId(rows[0].marketId);
      setMessage({ kind: "ok", text: `Loaded ${rows.length} Event Contract window${rows.length === 1 ? "" : "s"}.` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onConnect() {
    setBusy(true);
    setMessage(null);
    try {
      await connectExchange({
        network,
        privateKey: privateKey.trim() || undefined,
      });
      setConnected(true);
      const rows = await listWindows();
      setMarkets(rows);
      if (rows[0]) setSelectedId(rows[0].marketId);
      setMessage({ kind: "ok", text: `Loaded ${rows.length} Event Contract window${rows.length === 1 ? "" : "s"}.` });
    } catch (err) {
      setConnected(false);
      setMessage({
        kind: "error",
        text: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setBusy(false);
    }
  }

  function onDisconnect() {
    disconnectExchange();
    setConnected(false);
    setMarkets([]);
    setMessage({ kind: "ok", text: "Disconnected. The key is not stored on a server." });
  }

  async function onTrade(side: Side) {
    if (!selected) return;
    const q = quoteTicket(side, stake, selected.impliedUp);
    setBusy(true);
    setMessage(null);
    try {
      const result = await placeStake({ market: selected, side, stake });
      const rows = appendJournal({
        kind: "trade",
        marketId: selected.marketId,
        symbol: selected.symbol,
        side,
        stake,
        entryProb: q.entryProb,
        result: "pending",
        hash: result.hash,
        note: plainLanguage(selected, stake, side),
      });
      setJournal(rows);
      setTab("desk");
      setMessage({ kind: "ok", text: `Order submitted${result.hash ? ` - ${shorten(result.hash)}` : ""}.` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  async function onRedeem(marketId: string, symbol: string) {
    setBusy(true);
    setMessage(null);
    try {
      const result = await redeemMarket(marketId);
      appendJournal({
        kind: "redeem",
        marketId,
        symbol,
        result: "win",
        hash: result.hash,
        note: "Redeemed settled Event Contract",
      });

      if (rollAfterRedeem) {
        const next = markets.find((m) => m.status === "trading" && m.marketId !== marketId);
        if (next) {
          appendJournal({
            kind: "roll",
            marketId: next.marketId,
            symbol: next.symbol,
            note: `Ready to roll into ${next.asset} ${next.timeframe}`,
          });
          setSelectedId(next.marketId);
          setTab("markets");
          setJournal(loadJournal());
          setMessage({
            kind: "ok",
            text: `Redeemed. Next live window selected: ${next.asset} ${next.timeframe}. Place the roll on Markets.`,
          });
          setBusy(false);
          return;
        }
      }

      setJournal(loadJournal());
      setMessage({ kind: "ok", text: `Redeemed${result.hash ? ` - ${shorten(result.hash)}` : ""}.` });
    } catch (err) {
      setMessage({ kind: "error", text: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="top">
        <div className="brand">
          <h1>Keel</h1>
          <p>
            Event Contracts with a fixed line. Stake in plain language. Redeem what settled.
            Roll the next window. Shannon testnet by default.
          </p>
        </div>
        <div className="session">
          <label>Network</label>
          <div className="row">
            <select value={network} onChange={(e) => setNetwork(e.target.value as NetworkName)} disabled={connected}>
              <option value="shannon">Shannon testnet (50312)</option>
              <option value="mainnet">Somnia mainnet (5031)</option>
            </select>
          </div>
          <label>Session private key (optional, local only)</label>
          <div className="row">
            <input
              type="password"
              placeholder="0x... trading key - never a funded withdrawal wallet"
              value={privateKey}
              onChange={(e) => setPrivateKey(e.target.value)}
              disabled={connected}
              autoComplete="off"
            />
          </div>
          <div className="row">
            {connected ? (
              <>
                <button className="ghost" onClick={() => void refresh()} disabled={busy}>
                  Refresh markets
                </button>
                <button className="ghost" onClick={onDisconnect}>
                  Disconnect
                </button>
              </>
            ) : (
              <button onClick={() => void onConnect()} disabled={busy}>
                {busy ? "Connecting..." : "Connect and load windows"}
              </button>
            )}
          </div>
          <div className="muted">
            {connected
              ? `Connected${privateKey ? ` - ${maskKey(privateKey)}` : " - read-only"}`
              : "Read-only works without a key. Trading and redeem need a key."}
          </div>
        </div>
      </header>

      {message && <div className={`banner ${message.kind}`}>{message.text}</div>}

      <div className="tabs">
        <button className={tab === "markets" ? "active" : ""} onClick={() => setTab("markets")}>
          Markets
        </button>
        <button className={tab === "desk" ? "active" : ""} onClick={() => setTab("desk")}>
          Desk - {open.length} open - {claimable.length} claimable
        </button>
      </div>

      {tab === "markets" && (
        <div className="grid">
          <section className="card">
            <h2>Live windows</h2>
            {!connected && <p className="muted">Connect to load Event Contract markets from the Somnia indexer.</p>}
            {connected && markets.length === 0 && (
              <p className="muted">No binary windows returned. Confirm the indexer is reachable and SDK 0.28.1+.</p>
            )}
            {markets.map((m) => (
              <article
                key={m.marketId}
                className={`market ${selected?.marketId === m.marketId ? "selected" : ""}`}
                onClick={() => setSelectedId(m.marketId)}
              >
                <div className="market-top">
                  <strong>
                    {m.asset} - {m.timeframe}
                  </strong>
                  <span className={`badge ${m.status}`}>{STATUS_LABEL[m.status]}</span>
                </div>
                <div className="market-top" style={{ marginTop: 6 }}>
                  <span>Up {formatProb(m.impliedUp)}</span>
                  <span>{formatCountdown(m.secondsLeft)}</span>
                </div>
                <div className="muted" style={{ marginTop: 6 }}>
                  {shorten(m.marketId, 5)} - ask {m.bestAsk ?? "-"} - bid {m.bestBid ?? "-"}
                </div>
              </article>
            ))}
          </section>

          <section className="card">
            <h2>Ticket</h2>
            {!selected && <p className="muted">Select a window.</p>}
            {selected && quote && (
              <>
                <p className="plain">{plainLanguage(selected, stake, "up")}</p>
                <div className="ticket-math">
                  <div>
                    <span>Stake</span>
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      value={stake}
                      onChange={(e) => setStake(Number(e.target.value))}
                    />
                  </div>
                  <div>
                    <span>Up implied</span>
                    {formatProb(selected.impliedUp)}
                  </div>
                  <div>
                    <span>If you stake Up</span>
                    redeem ~{formatUsd(quoteTicket("up", stake, selected.impliedUp).redeemIfWin)}
                  </div>
                  <div>
                    <span>If you stake Down</span>
                    redeem ~{formatUsd(quoteTicket("down", stake, selected.impliedUp).redeemIfWin)}
                  </div>
                  <div>
                    <span>Maximum loss</span>
                    {formatUsd(stake)}
                  </div>
                  <div>
                    <span>Reference</span>
                    {selected.openingPriceLabel}
                  </div>
                </div>
                <div className="actions">
                  <button
                    className="up"
                    disabled={busy || !privateKey || selected.status !== "trading"}
                    onClick={() => void onTrade("up")}
                  >
                    Stake Up
                  </button>
                  <button
                    className="down"
                    disabled={busy || !privateKey || selected.status !== "trading"}
                    onClick={() => void onTrade("down")}
                  >
                    Stake Down
                  </button>
                </div>
                <p className="muted" style={{ marginTop: 12 }}>
                  Orders are IOC limits through @somnia-chain/markets-sdk. Writes are refused unless on-chain status is
                  Trading (1). Use a session key that cannot withdraw.
                </p>
              </>
            )}
          </section>
        </div>
      )}

      {tab === "desk" && (
        <div className="grid">
          <section className="card">
            <h2>Open and claimable</h2>
            <label className="muted" style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 12 }}>
              <input type="checkbox" checked={rollAfterRedeem} onChange={(e) => setRollAfterRedeem(e.target.checked)} />
              After redeem, select the next live window for a roll
            </label>
            <div className="actions" style={{ marginBottom: 14 }}>
              <button
                disabled={busy || claimable.length === 0 || !privateKey}
                onClick={() => {
                  void (async () => {
                    for (const item of claimable) {
                      await onRedeem(item.marketId, item.symbol);
                    }
                  })();
                }}
              >
                Redeem all claimable
              </button>
            </div>
            <h3 className="muted">Open</h3>
            {open.length === 0 && <p className="muted">No open trades in the local journal.</p>}
            {open.map((p) => (
              <div key={p.marketId + p.side} className="market">
                <div className="market-top">
                  <strong>
                    {p.side.toUpperCase()} - {shorten(p.symbol, 8)}
                  </strong>
                  <span className={`badge ${p.status}`}>{STATUS_LABEL[p.status]}</span>
                </div>
                <div className="muted">
                  stake {formatUsd(p.stake)} - {formatUsd(p.contracts, 3)} contracts @ {formatProb(p.entryProb)}
                </div>
              </div>
            ))}
            <h3 className="muted">Claimable</h3>
            {claimable.length === 0 && (
              <p className="muted">Nothing to redeem yet. Settled journal trades will appear here.</p>
            )}
            {claimable.map((c) => (
              <div key={c.marketId} className="market">
                <div className="market-top">
                  <strong>{shorten(c.symbol, 8)}</strong>
                  <button disabled={busy || !privateKey} onClick={() => void onRedeem(c.marketId, c.symbol)}>
                    Redeem
                  </button>
                </div>
                <div className="muted">est. payout {formatUsd(c.estimatedPayout)}</div>
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Journal</h2>
            <table>
              <thead>
                <tr>
                  <th>When</th>
                  <th>Kind</th>
                  <th>Market</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {journal.length === 0 && (
                  <tr>
                    <td colSpan={4} className="muted">
                      Empty. Trades, redeems, and rolls are stored in this browser only.
                    </td>
                  </tr>
                )}
                {journal.map((row) => (
                  <tr key={row.id}>
                    <td>{new Date(row.at).toLocaleString()}</td>
                    <td>{row.kind}</td>
                    <td>{shorten(row.symbol || row.marketId, 6)}</td>
                    <td>
                      {row.side ? row.side.toUpperCase() + " - " : ""}
                      {row.stake !== undefined ? `stake ${formatUsd(row.stake)} - ` : ""}
                      {row.hash ? shorten(row.hash) : row.note || row.result || ""}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
      )}
    </div>
  );
}
