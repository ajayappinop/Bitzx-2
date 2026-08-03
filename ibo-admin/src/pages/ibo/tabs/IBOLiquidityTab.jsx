import { useEffect, useState, useCallback } from 'react';
import { Layers, Save, AlertCircle } from 'lucide-react';
import { api } from '@/lib/api';

function Toggle({ checked, onChange, label, description }) {
  return (
    <div className="flex items-start justify-between gap-4 py-3 border-b border-white/5 last:border-0">
      <div>
        <div className="text-sm font-semibold text-white">{label}</div>
        {description && <div className="text-xs text-white/40 mt-0.5">{description}</div>}
      </div>
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 mt-0.5 ${checked ? 'bg-gold' : 'bg-white/20'}`}
      >
        <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform ${checked ? 'translate-x-5.5' : 'translate-x-0.5'}`} />
      </button>
    </div>
  );
}

export default function IBOLiquidityTab() {
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState(null);
  const [success, setSuccess] = useState(null);

  const [enabled, setEnabled]     = useState(true);
  const [depth, setDepth]         = useState(20);
  const [spread, setSpread]       = useState(25);

  const load = useCallback(async () => {
    setLoading(true); setErr(null); setSuccess(null);
    try {
      const res = await api.ibo.getLiquidity();
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed to load');
      setData(d);
      setEnabled(d.ibo_liquidity_enabled !== false);
      setDepth(d.ibo_market_depth_levels ?? 20);
      setSpread(d.ibo_spread_bps_default ?? 25);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setSaving(true); setErr(null); setSuccess(null);
    try {
      const res = await api.ibo.updateLiquidity({
        ibo_liquidity_enabled:   enabled,
        ibo_market_depth_levels: Number(depth),
        ibo_spread_bps_default:  Number(spread),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Update failed');
      setSuccess('Liquidity settings saved.');
    } catch (e) { setErr(e.message); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="text-white/40 text-sm py-8 text-center">Loading liquidity settings…</div>;

  return (
    <div className="space-y-6 max-w-xl">
      <div className="rounded-xl border border-white/8 bg-white/2 p-5 space-y-1">
        <h3 className="text-sm font-bold text-white flex items-center gap-2 mb-3"><Layers size={16} className="text-gold-light" /> Market Making Controls</h3>
        <Toggle
          checked={enabled}
          onChange={setEnabled}
          label="Enable IBO Liquidity"
          description="When ON, the SYSTEM counterparty fills market order remainders on IBO-quoted pairs."
        />
      </div>

      <div className="rounded-xl border border-white/8 bg-white/2 p-5 space-y-5">
        <h3 className="text-sm font-bold text-white">Order Book Depth</h3>
        <div>
          <label className="text-xs text-white/50 mb-1 block">Depth Levels: <strong className="text-gold-light">{depth}</strong></label>
          <input
            type="range" min="5" max="100" step="5"
            value={depth}
            onChange={(e) => setDepth(e.target.value)}
            className="w-full accent-gold"
          />
          <div className="flex justify-between text-xs text-white/30 mt-1"><span>5</span><span>100</span></div>
          <p className="text-xs text-white/30 mt-1">Number of price levels generated on each side of the order book.</p>
        </div>

        <div>
          <label className="text-xs text-white/50 mb-1 block">Default Spread: <strong className="text-gold-light">{spread} bps</strong></label>
          <input
            type="range" min="0" max="200" step="5"
            value={spread}
            onChange={(e) => setSpread(e.target.value)}
            className="w-full accent-gold"
          />
          <div className="flex justify-between text-xs text-white/30 mt-1"><span>0 bps</span><span>200 bps</span></div>
          <p className="text-xs text-white/30 mt-1">Basis points added to SYSTEM fills on all IBO-quoted pairs (per-pair overrides on the Price tab take precedence).</p>
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
