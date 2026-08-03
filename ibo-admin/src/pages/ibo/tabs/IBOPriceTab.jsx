import { useEffect, useState, useCallback } from 'react';
import { DollarSign, Save, Trash2, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

const IBO_PAIRS = ['BTCIBO', 'ETHIBO', 'BNBIBO', 'SOLIBO', 'XRPIBO', 'DOGEIBO'];

export default function IBOPriceTab() {
  const [data, setData]     = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]  = useState(false);
  const [clearing, setClearing] = useState(false);
  const [err, setErr]        = useState(null);
  const [success, setSuccess] = useState(null);

  const [priceOverride, setPriceOverride] = useState('');
  const [spreadDefault, setSpreadDefault] = useState('');
  const [spreadBySymbol, setSpreadBySymbol] = useState({});

  const load = useCallback(async () => {
    setLoading(true); setErr(null); setSuccess(null);
    try {
      const res = await api.ibo.getPrice();
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed to load price config');
      setData(d);
      setPriceOverride(d.ibo_price_override != null ? String(d.ibo_price_override) : '');
      setSpreadDefault(String(d.ibo_spread_bps_default ?? 25));
      setSpreadBySymbol(d.ibo_spread_bps_by_symbol || {});
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setErr(null); setSuccess(null);
    try {
      const body = {};
      if (priceOverride.trim()) {
        const v = parseFloat(priceOverride);
        if (isNaN(v) || v <= 0) throw new Error('Price override must be a positive number');
        body.ibo_price_override = v;
      }
      const sd = parseFloat(spreadDefault);
      if (!isNaN(sd)) body.ibo_spread_bps_default = sd;
      body.ibo_spread_bps_by_symbol = {};
      for (const [sym, val] of Object.entries(spreadBySymbol)) {
        const v = parseFloat(val);
        if (!isNaN(v)) body.ibo_spread_bps_by_symbol[sym] = v;
      }
      const res = await api.ibo.updatePrice(body);
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Update failed');
      setSuccess('Price settings saved successfully.');
      load();
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  const clearOverride = async () => {
    setClearing(true); setErr(null); setSuccess(null);
    try {
      const res = await api.ibo.clearPriceOverride();
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed to clear override');
      setSuccess('Price override cleared. Now using built-in constant ($0.4523).');
      setPriceOverride('');
      load();
    } catch (e) { setErr(e.message); }
    finally { setClearing(false); }
  };

  if (loading) return <div className="text-white/40 text-sm py-8 text-center">Loading price config…</div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <div className="rounded-xl border border-white/8 bg-white/2 p-5 space-y-4">
        <h3 className="text-sm font-bold text-white flex items-center gap-2"><DollarSign size={16} className="text-gold-light" /> IBO Price Override</h3>
        <p className="text-xs text-white/40">
          Set a manual USDT price for IBO. Leave empty to use the built-in constant ($0.4523).
          All IBO-quoted pair prices derive from this value: <span className="font-mono text-gold-light">pair_price = base_usdt / ibo_price</span>.
        </p>
        <div className="flex gap-3">
          <input
            type="number" step="0.0001" min="0.00001"
            value={priceOverride}
            onChange={(e) => setPriceOverride(e.target.value)}
            placeholder="e.g. 0.4523"
            className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white placeholder:text-white/25 focus:outline-none focus:border-gold/50"
          />
          {data?.ibo_price_override != null && (
            <button
              onClick={clearOverride} disabled={clearing}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 transition-colors"
            >
              <Trash2 size={14} /> {clearing ? 'Clearing…' : 'Clear'}
            </button>
          )}
        </div>
        {data?.ibo_price_override != null && (
          <p className="text-xs text-gold">Currently overridden at <strong>${data.ibo_price_override}</strong></p>
        )}
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 p-5 space-y-4">
        <h3 className="text-sm font-bold text-white">Spread Configuration</h3>
        <div>
          <label className="text-xs text-white/50 mb-1 block">Default Spread (bps)</label>
          <input
            type="number" step="1" min="0" max="500"
            value={spreadDefault}
            onChange={(e) => setSpreadDefault(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-gold/50"
          />
          <p className="text-xs text-white/30 mt-1">Applied to all IBO-quoted pair fills. 1 bp = 0.01%</p>
        </div>

        <div>
          <label className="text-xs text-white/50 mb-2 block">Per-Pair Spread Overrides (bps)</label>
          <div className="space-y-2">
            {IBO_PAIRS.map((sym) => (
              <div key={sym} className="flex items-center gap-3">
                <span className="text-xs text-white/60 w-20 font-mono">{sym}</span>
                <input
                  type="number" step="1" min="0" max="500"
                  value={spreadBySymbol[sym] ?? ''}
                  onChange={(e) => setSpreadBySymbol((prev) => ({ ...prev, [sym]: e.target.value }))}
                  placeholder={`Default (${spreadDefault} bps)`}
                  className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder:text-white/20 focus:outline-none focus:border-gold/50"
                />
              </div>
            ))}
          </div>
        </div>
      </div>

      {err     && <div className="flex items-center gap-2 text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-4 py-3"><AlertCircle size={14}/>{err}</div>}
      {success && <div className="text-green-400 text-sm bg-green-500/10 border border-green-500/20 rounded-lg px-4 py-3">{success}</div>}

      <button
        onClick={save} disabled={saving}
        className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-gold/15 border border-gold/30 text-gold-light font-bold text-sm hover:bg-gold/25 transition-colors"
      >
        <Save size={14} /> {saving ? 'Saving…' : 'Save Changes'}
      </button>
    </div>
  );
}
