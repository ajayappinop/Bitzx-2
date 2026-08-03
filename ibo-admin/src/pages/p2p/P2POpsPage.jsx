import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Loader2, AlertCircle, Flag, BarChart3, ShieldCheck, Users, Activity, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import P2PAdsTab       from './tabs/P2PAdsTab';
import P2POrdersTab    from './tabs/P2POrdersTab';
import P2PDisputesTab  from './tabs/P2PDisputesTab';
import P2PMerchantsTab from './tabs/P2PMerchantsTab';
import P2PFraudTab     from './tabs/P2PFraudTab';

const TABS = [
  { key: 'disputes',  label: 'Disputes',    icon: Flag },
  { key: 'orders',    label: 'Orders',      icon: Activity },
  { key: 'ads',       label: 'Ads',         icon: BarChart3 },
  { key: 'merchants', label: 'Merchants',   icon: ShieldCheck },
  { key: 'fraud',     label: 'Fraud Intel', icon: Users },
];

export default function P2POpsPage() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'disputes';
  const setTab = (t) => setSp({ tab: t });

  const [kpis, setKpis]     = useState(null);
  const [kpiErr, setKpiErr] = useState('');
  const [kpiLoading, setKpiLoading] = useState(true);

  const loadKpis = () => {
    setKpiLoading(true);
    api.p2p.kpis()
      .then((r) => r.json())
      .then((d) => { setKpis(d); setKpiErr(''); })
      .catch((e) => setKpiErr(e.message))
      .finally(() => setKpiLoading(false));
  };

  useEffect(() => { loadKpis(); }, []);

  const k = kpis || {};

  return (
    <div className="admin-page space-y-5">

      {/* KPI row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex flex-wrap gap-3">
          <KpiCard label="Active Ads"        value={k.active_ads        ?? '—'} loading={kpiLoading} />
          <KpiCard label="Open Orders"       value={k.open_orders       ?? '—'} loading={kpiLoading} accent="amber" />
          <KpiCard label="Open Disputes"     value={k.open_disputes     ?? '—'} loading={kpiLoading} accent="rose" />
          <KpiCard label="Pending Merchants" value={k.pending_merchants ?? '—'} loading={kpiLoading} accent="sky" />
          <KpiCard label="Volume 24h"        value={k.volume_24h_inr != null ? `₹${Number(k.volume_24h_inr).toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : '—'} loading={kpiLoading} />
          <KpiCard label="Trades 24h"        value={k.trades_24h        ?? '—'} loading={kpiLoading} />
          <KpiCard label="Banned Users"      value={k.banned_users      ?? '—'} loading={kpiLoading} accent="rose" />
        </div>
        <button
          type="button"
          onClick={loadKpis}
          disabled={kpiLoading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-surface-border px-3 py-2 text-white/80 text-sm font-bold disabled:opacity-40"
        >
          <RefreshCw size={13} className={kpiLoading ? 'animate-spin' : ''} /> Refresh
        </button>
      </div>

      {kpiErr && (
        <p className="text-red-400 text-sm flex items-center gap-1.5">
          <AlertCircle size={14} /> {kpiErr}
        </p>
      )}

      {/* Tab bar */}
      <div className="grid grid-cols-2 gap-1 rounded-2xl border border-surface-border bg-surface-card p-1 md:grid-cols-3 xl:grid-cols-5">
        {TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`flex w-full items-center justify-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold whitespace-nowrap transition-colors ${
              tab === key
                ? 'bg-white/10 text-white'
                : 'text-white/50 hover:text-white hover:bg-white/[.05]'
            }`}
          >
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      {tab === 'ads'       && <P2PAdsTab />}
      {tab === 'orders'    && <P2POrdersTab />}
      {tab === 'disputes'  && <P2PDisputesTab />}
      {tab === 'merchants' && <P2PMerchantsTab />}
      {tab === 'fraud'     && <P2PFraudTab />}
    </div>
  );
}

function KpiCard({ label, value, accent, loading }) {
  const valCls = accent === 'rose'
    ? 'text-rose-300'
    : accent === 'amber'
    ? 'text-gold-light'
    : accent === 'sky'
    ? 'text-sky-300'
    : 'text-white';
  return (
    <div className="rounded-2xl border border-surface-border bg-surface-card px-4 py-3 min-w-[100px]">
      <p className="text-[10px] font-extrabold uppercase tracking-wider text-white/45">{label}</p>
      <p className={`text-xl font-extrabold tabular-nums mt-1 ${valCls}`}>
        {loading ? <Loader2 size={14} className="inline animate-spin opacity-50" /> : value}
      </p>
    </div>
  );
}
