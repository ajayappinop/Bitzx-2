import { useEffect, useMemo, useState } from 'react';
import { Coins, ArrowDownCircle, Search, Sparkles, Save } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminDataTable } from '@/components/AdminPrimitives';

const GAS_CHAIN_KEYS = [
  { id: 'bsc', label: 'BSC (BEP-20)' },
  { id: 'eth', label: 'Ethereum (ERC-20)' },
  { id: 'tron', label: 'Tron (TRC-20)' },
  { id: 'btc', label: 'Bitcoin' },
  { id: 'solana', label: 'Solana' },
];

const SUGGESTED_GAS = { bsc: '2', eth: '15', tron: '1', btc: '5', solana: '1' };

function emptyGasByChain() {
  return Object.fromEntries(GAS_CHAIN_KEYS.map((c) => [c.id, '']));
}

export default function FeesCommissionsPanel() {
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [saving, setSaving] = useState(false);
  const [controls, setControls] = useState(null);
  const [spotStats, setSpotStats] = useState([]);
  const [pairFees, setPairFees] = useState([]);
  const [pairFeeEdits, setPairFeeEdits] = useState({});
  const [savingPair, setSavingPair] = useState('');
  const [pairSearch, setPairSearch] = useState('');
  const [form, setForm] = useState({
    maker_fee_rate: '',
    taker_fee_rate: '',
    withdraw_fee_rate: '',
    withdraw_gas_fee_ibo: '',
  });
  const [gasByChain, setGasByChain] = useState(emptyGasByChain);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const [controlsRes, spotFeesRes, pairFeesRes] = await Promise.all([
          api.platformControls(),
          api.statsFees(),
          api.adminMarketPairs(),
        ]);
        const controlsBody = await controlsRes.json().catch(() => ({}));
        const spotFeesBody = await spotFeesRes.json().catch(() => ({}));
        const pairFeesBody = await pairFeesRes.json().catch(() => ({}));
        if (!alive) return;
        if (controlsRes.ok) {
          setControls(controlsBody);
          if (!saving) {
            setForm({
              maker_fee_rate: String(controlsBody.maker_fee_rate ?? 0.001),
              taker_fee_rate: String(controlsBody.taker_fee_rate ?? 0.001),
              withdraw_fee_rate: String(controlsBody.withdraw_fee_rate ?? 0),
              withdraw_gas_fee_ibo: String(controlsBody.withdraw_gas_fee_ibo ?? 0),
            });
            const stored = controlsBody.withdraw_gas_fee_ibo_by_chain;
            const nextGas = emptyGasByChain();
            if (stored && typeof stored === 'object') {
              for (const c of GAS_CHAIN_KEYS) {
                const v = stored[c.id];
                if (v != null && v !== '') nextGas[c.id] = String(v);
              }
            }
            setGasByChain(nextGas);
          }
        }
        if (spotFeesRes.ok) {
          setSpotStats(Array.isArray(spotFeesBody.by_asset) ? spotFeesBody.by_asset : []);
        } else {
          setSpotStats([]);
        }
        if (pairFeesRes.ok) {
          const rows = Array.isArray(pairFeesBody.items) ? pairFeesBody.items : [];
          setPairFees(rows);
          setPairFeeEdits((prev) => {
            const next = { ...prev };
            for (const r of rows) {
              const sym = String(r.symbol || '').toUpperCase();
              if (!sym) continue;
              if (!next[sym]) {
                next[sym] = {
                  maker_fee_rate: String(r.maker_fee_rate ?? 0),
                  taker_fee_rate: String(r.taker_fee_rate ?? 0),
                };
              }
            }
            return next;
          });
        } else {
          setPairFees([]);
        }
      } catch {
        if (!alive) return;
        setSpotStats([]);
        setPairFees([]);
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [saving]);

  const save = async () => {
    setErr('');
    setOk('');
    try {
      setSaving(true);
      const byChain = {};
      for (const c of GAS_CHAIN_KEYS) {
        const raw = String(gasByChain[c.id] ?? '').trim();
        if (raw === '') continue;
        const n = Number(raw);
        if (!Number.isFinite(n) || n < 0) {
          throw new Error(`Invalid ${c.label} gas fee`);
        }
        byChain[c.id] = n;
      }
      const payload = {
        maker_fee_rate: Number(form.maker_fee_rate),
        taker_fee_rate: Number(form.taker_fee_rate),
        withdraw_fee_rate: Number(form.withdraw_fee_rate),
        withdraw_gas_fee_ibo: Number(form.withdraw_gas_fee_ibo),
        withdraw_gas_fee_ibo_by_chain: byChain,
      };
      const r = await api.patchPlatformControls(payload);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Fee update failed');
      setControls(j);
      setOk('Fee settings updated. Withdrawals use these Delta amounts immediately.');
    } catch (e) {
      setErr(e?.message || 'Fee update failed');
    } finally {
      setSaving(false);
    }
  };

  const savePairFees = async (symbol) => {
    const row = pairFeeEdits[symbol] || {};
    setErr('');
    setOk('');
    try {
      setSavingPair(symbol);
      const body = {
        maker_fee_rate: Number(row.maker_fee_rate),
        taker_fee_rate: Number(row.taker_fee_rate),
      };
      const r = await api.patchMarketPair(symbol, body);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || `Failed to update ${symbol} fees`);
      const patch = j.pair || {};
      setPairFees((prev) => prev.map((x) => (
        String(x.symbol || '').toUpperCase() === symbol ? { ...x, ...patch } : x
      )));
      setOk(`${symbol} fees updated.`);
    } catch (e) {
      setErr(e?.message || 'Pair fee update failed');
    } finally {
      setSavingPair('');
    }
  };

  const filteredPairFees = useMemo(() => {
    const q = pairSearch.trim().toUpperCase();
    if (!q) return pairFees;
    return pairFees.filter((r) => String(r.symbol || '').toUpperCase().includes(q));
  }, [pairFees, pairSearch]);

  return (
    <div className="relative overflow-hidden rounded-3xl border border-surface-border bg-[radial-gradient(120%_100%_at_0%_0%,rgba(16,185,129,0.16),transparent_45%),radial-gradient(120%_100%_at_100%_100%,rgba(56,189,248,0.14),transparent_50%),linear-gradient(145deg,rgba(9,14,23,0.97),rgba(2,8,18,0.95))] p-5 sm:p-7 shadow-[0_24px_60px_rgba(0,0,0,0.5)]">
      <div className="pointer-events-none absolute -top-20 -left-20 h-48 w-48 rounded-full bg-emerald-500/15 blur-3xl" />
      <div className="pointer-events-none absolute -bottom-24 -right-16 h-56 w-56 rounded-full bg-cyan-500/15 blur-3xl" />
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="inline-flex items-center gap-2 rounded-full border border-emerald-300/30 bg-emerald-300/10 px-3 py-1 text-[11px] font-bold uppercase tracking-[0.18em] text-emerald-200">
            <Sparkles size={12} /> Fee Control Center
          </p>
          <h3 className="mt-3 text-2xl font-black tracking-tight text-white">Fees & Commissions</h3>
          <p className="mt-1 text-sm text-slate-300">Tune global and pair-level fee rates with a cleaner operational workspace.</p>
        </div>
        <button
          type="button"
          disabled={saving}
          onClick={save}
          className="inline-flex items-center gap-2 rounded-xl border border-emerald-300/35 bg-gradient-to-r from-emerald-400/25 to-cyan-400/20 px-4 py-2.5 text-sm font-bold text-emerald-100 shadow-[0_10px_22px_rgba(16,185,129,0.28)] transition-all hover:-translate-y-0.5 hover:from-emerald-400/35 hover:to-cyan-400/35"
        >
          <Save size={14} />
          {saving ? 'Saving…' : 'Save Global Fees'}
        </button>
      </div>
      {err ? <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-xs text-red-200">{err}</div> : null}
      {ok ? <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-200">{ok}</div> : null}
      <div className="mb-5 h-1.5 w-full rounded-full bg-gradient-to-r from-emerald-400/70 via-cyan-400/70 to-sky-400/70" />
      <div className="mb-5 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-cyan-300/30 bg-cyan-400/10 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <p className="text-[10px] uppercase tracking-[0.16em] text-cyan-100/70">Pairs</p>
          <p className="mt-1 inline-flex items-center gap-1 text-base font-extrabold text-cyan-100"><Coins size={14} /> {pairFees.length}</p>
        </div>
        <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-100/70">Assets (Spot Fees)</p>
          <p className="text-base font-extrabold text-emerald-100">{spotStats.length}</p>
        </div>
        <div className="rounded-2xl border border-emerald-300/30 bg-emerald-400/10 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <p className="text-[10px] uppercase tracking-[0.16em] text-emerald-100/70">Global Maker</p>
          <p className="text-base font-mono font-extrabold text-emerald-100">{String(controls?.maker_fee_rate ?? form.maker_fee_rate ?? 0)}</p>
        </div>
        <div className="rounded-2xl border border-sky-300/30 bg-sky-400/10 p-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]">
          <p className="text-[10px] uppercase tracking-[0.16em] text-sky-100/70">Global Taker</p>
          <p className="text-base font-mono font-extrabold text-sky-100">{String(controls?.taker_fee_rate ?? form.taker_fee_rate ?? 0)}</p>
        </div>
      </div>
      <div className="grid xl:grid-cols-12 gap-4">
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4 xl:col-span-8 backdrop-blur-sm">
          <p className="mb-3 inline-flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.12em] text-emerald-100"><Coins size={16} className="text-emerald-300" /> Spot Fees</p>
          <div className="space-y-3">
            <label className="block text-xs text-white/70">
              Maker fee rate
              <input
                value={form.maker_fee_rate}
                onChange={(e) => setForm((v) => ({ ...v, maker_fee_rate: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-surface-border bg-surface-dark px-3 py-2 text-white font-mono focus:outline-none focus:border-emerald-300/55"
              />
            </label>
            <label className="block text-xs text-white/70">
              Taker fee rate
              <input
                value={form.taker_fee_rate}
                onChange={(e) => setForm((v) => ({ ...v, taker_fee_rate: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-surface-border bg-surface-dark px-3 py-2 text-white font-mono focus:outline-none focus:border-sky-300/55"
              />
            </label>
          </div>
          <AdminDataTable className="mt-4 !rounded-xl shadow-[0_10px_24px_rgba(16,185,129,0.08)]">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="text-right">Spot Fees Collected</th>
              </tr>
            </thead>
            <tbody>
              {spotStats.length === 0 ? (
                <tr><td colSpan={2} className="text-slate-300/70">No spot fee rows.</td></tr>
              ) : spotStats.map((r) => (
                <tr key={r.asset}>
                  <td className="text-slate-100">{r.asset}</td>
                  <td className="text-right font-mono text-emerald-200">{Number(r.total || 0).toFixed(8)}</td>
                </tr>
              ))}
            </tbody>
          </AdminDataTable>
          <div className="mt-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-slate-200/85">Pair Fees</p>
              <div className="ml-auto relative w-full sm:w-64">
                <Search size={14} className="absolute left-2.5 top-2.5 text-slate-300/65" />
                <input
                  value={pairSearch}
                  onChange={(e) => setPairSearch(e.target.value)}
                  placeholder="Search pair (e.g. BTCUSDT)"
                  className="w-full rounded-xl border border-surface-border bg-surface-dark pl-8 pr-3 py-2 text-xs text-white font-mono focus:outline-none focus:border-cyan-300/50"
                />
              </div>
            </div>
            <AdminDataTable minWidth="560px" className="!rounded-xl shadow-[0_10px_24px_rgba(6,182,212,0.12)] max-h-[420px] overflow-auto">
              <thead>
                <tr>
                  <th className="sticky top-0 z-20 bg-surface-card">Pair</th>
                  <th className="sticky top-0 z-20 bg-surface-card text-right">Maker Fee</th>
                  <th className="sticky top-0 z-20 bg-surface-card text-right">Taker Fee</th>
                  <th className="sticky top-0 z-20 bg-surface-card text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {filteredPairFees.length === 0 ? (
                  <tr><td colSpan={4} className="text-slate-300/70">No pair fee rows.</td></tr>
                ) : filteredPairFees.map((r) => {
                  const sym = String(r.symbol || '').toUpperCase();
                  const edit = pairFeeEdits[sym] || {
                    maker_fee_rate: String(r.maker_fee_rate ?? 0),
                    taker_fee_rate: String(r.taker_fee_rate ?? 0),
                  };
                  return (
                    <tr key={sym}>
                      <td className="font-mono text-gold-light/90">{sym}</td>
                      <td className="text-right">
                        <input
                          value={edit.maker_fee_rate}
                          onChange={(e) => setPairFeeEdits((prev) => ({ ...prev, [sym]: { ...edit, maker_fee_rate: e.target.value } }))}
                          className="w-24 rounded border border-surface-border bg-surface-dark px-2 py-1 text-right font-mono text-emerald-200 focus:outline-none focus:border-emerald-300/55"
                        />
                      </td>
                      <td className="text-right">
                        <input
                          value={edit.taker_fee_rate}
                          onChange={(e) => setPairFeeEdits((prev) => ({ ...prev, [sym]: { ...edit, taker_fee_rate: e.target.value } }))}
                          className="w-24 rounded border border-surface-border bg-surface-dark px-2 py-1 text-right font-mono text-cyan-200 focus:outline-none focus:border-cyan-300/55"
                        />
                      </td>
                      <td className="text-right">
                        <button
                          type="button"
                          disabled={savingPair === sym}
                          onClick={() => savePairFees(sym)}
                          className="rounded-lg border border-cyan-300/40 bg-cyan-400/20 px-2 py-1 font-bold text-cyan-100 shadow-[0_6px_14px_rgba(6,182,212,0.2)] transition-all hover:-translate-y-0.5 hover:bg-cyan-400/35"
                        >
                          {savingPair === sym ? 'Saving…' : 'Save'}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </AdminDataTable>
          </div>
        </div>

        <div className="rounded-2xl border border-surface-border bg-surface-card p-4 xl:col-span-4 backdrop-blur-sm">
          <p className="mb-3 inline-flex items-center gap-2 text-sm font-extrabold uppercase tracking-[0.12em] text-sky-100"><ArrowDownCircle size={16} className="text-cyan-300" /> Withdrawal Fees (Delta)</p>
          <div className="space-y-3">
            <label className="block text-xs text-white/70">
              Platform fee rate (→ Delta)
              <input
                value={form.withdraw_fee_rate}
                onChange={(e) => setForm((v) => ({ ...v, withdraw_fee_rate: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-surface-border bg-surface-dark px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-300/55"
              />
              <span className="mt-1 block text-[11px] text-white/45">Fraction of USDT notional (0.001 = 0.1%). Converted to Delta. 0 = off.</span>
            </label>
            <label className="block text-xs text-white/70">
              Default gas fee (Delta)
              <input
                value={form.withdraw_gas_fee_ibo}
                onChange={(e) => setForm((v) => ({ ...v, withdraw_gas_fee_ibo: e.target.value }))}
                className="mt-1 w-full rounded-xl border border-surface-border bg-surface-dark px-3 py-2 text-white font-mono focus:outline-none focus:border-cyan-300/55"
              />
              <span className="mt-1 block text-[11px] text-white/45">Used when a chain has no override below. 0 = no gas fee.</span>
            </label>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs text-white/70">Per-chain gas fee (Delta)</p>
                <button
                  type="button"
                  onClick={() => setGasByChain({ ...SUGGESTED_GAS })}
                  className="text-[11px] font-bold text-cyan-200/90 hover:text-cyan-100"
                >
                  Fill suggested
                </button>
              </div>
              {GAS_CHAIN_KEYS.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-xs text-white/70">
                  <span className="w-28 shrink-0">{c.label}</span>
                  <input
                    value={gasByChain[c.id] ?? ''}
                    placeholder={`default ${form.withdraw_gas_fee_ibo || '0'}`}
                    onChange={(e) => setGasByChain((v) => ({ ...v, [c.id]: e.target.value }))}
                    className="flex-1 rounded-lg border border-surface-border bg-surface-dark px-2 py-1.5 text-white font-mono focus:outline-none focus:border-cyan-300/55"
                  />
                </label>
              ))}
              <p className="text-[11px] text-white/45">Leave a chain blank to use the default gas fee above. Only values saved here are charged — no hidden defaults.</p>
            </div>
            <div className="rounded-xl border border-sky-300/35 bg-sky-400/10 p-3 text-xs text-sky-100/85">
              Withdrawal fees are charged only in Delta from the user&apos;s spot wallet, using these admin settings. Platform pays real BNB/ETH/TRX gas on-chain.
            </div>
            <div className="rounded-xl border border-surface-border bg-surface-dark p-3 space-y-2">
              <p className="mb-1 text-[11px] uppercase tracking-[0.12em] text-slate-300/70">Saved live config</p>
              <p className="text-sm font-mono text-cyan-200">Fee rate: {String(controls?.withdraw_fee_rate ?? form.withdraw_fee_rate ?? 0)}</p>
              <p className="text-sm font-mono text-cyan-200">Default gas: {String(controls?.withdraw_gas_fee_ibo ?? form.withdraw_gas_fee_ibo ?? 0)} Delta</p>
              {controls?.withdraw_gas_fee_ibo_by_chain && typeof controls.withdraw_gas_fee_ibo_by_chain === 'object' ? (
                <p className="text-[11px] font-mono text-cyan-200/80 break-all">
                  Per-chain: {JSON.stringify(controls.withdraw_gas_fee_ibo_by_chain)}
                </p>
              ) : (
                <p className="text-[11px] text-white/45">No per-chain overrides saved yet.</p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
