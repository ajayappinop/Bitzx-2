import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import {
  AdminPanel, GradientStatCard, StatusBadge, FilterBar,
} from '@/components/AdminPrimitives';
import {
  RefreshCw, ExternalLink, Coins, Shield, Wallet, AlertTriangle,
  CheckCircle, Database, Link2,
} from 'lucide-react';

const API_BASE = (import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000').replace(/\/$/, '');

function fmtNum(n, digits = 0) {
  if (n == null || n === '') return '—';
  const x = Number(n);
  if (Number.isNaN(x)) return String(n);
  return x.toLocaleString(undefined, { maximumFractionDigits: digits });
}

function DetailCell({ label, value, mono, children }) {
  return (
    <div className="rounded-xl border border-surface-border/80 bg-white/[0.02] p-3">
      <p className="text-[10px] font-bold uppercase tracking-wider text-white/45 mb-1">{label}</p>
      {children || (
        <p className={`text-sm text-white/90 break-all ${mono ? 'font-mono text-xs' : ''}`}>{value ?? '—'}</p>
      )}
    </div>
  );
}

function TogglePill({ on, onClick, label, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold transition-colors disabled:opacity-40 ${
        on ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200' : 'border-surface-border bg-white/5 text-white/50'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${on ? 'bg-emerald-400' : 'bg-white/30'}`} />
      {label}
    </button>
  );
}

export default function IboPlatformTab({ onError, onOk }) {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_listings');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    onError('');
    try {
      const res = await api.listings.platformToken();
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Failed to load IBO overview');
      setData(json);
    } catch (e) {
      onError(e.message || 'Load failed');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [onError]);

  useEffect(() => { load(); }, [load]);

  const reseed = async () => {
    if (!canManage) return;
    setBusy(true);
    onError('');
    try {
      const res = await api.listings.reseedPlatformToken();
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Reseed failed');
      setData(json);
      onOk('IBO token re-seeded from environment. Restart not required.');
    } catch (e) {
      onError(e.message || 'Reseed failed');
    } finally {
      setBusy(false);
    }
  };

  const patchFlag = async (field) => {
    const tok = data?.token;
    if (!tok?.id || !canManage) return;
    onError('');
    try {
      const res = await api.listings.patchToken(tok.id, { [field]: !tok[field] });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail || 'Update failed');
      await load();
      onOk('IBO settings updated.');
    } catch (e) {
      onError(e.message || 'Update failed');
    }
  };

  if (loading && !data) {
    return <p className="text-white/50 text-sm py-12 text-center">Loading IBO platform token…</p>;
  }

  if (!data) {
    return (
      <AdminPanel title="IBO not configured" subtitle="Set IBO_CONTRACT_ADDRESS in backend .env and reseed.">
        <p className="text-white/55 text-sm">Could not load platform token overview.</p>
        {canManage ? (
          <button type="button" onClick={reseed} disabled={busy} className="mt-4 px-4 py-2 rounded-xl border border-gold/40 text-sm font-bold">
            Apply env &amp; seed IBO
          </button>
        ) : null}
      </AdminPanel>
    );
  }

  const tok = data.token || {};
  const chain = data.on_chain || {};
  const scan = data.bscscan || {};
  const rails = data.deposit_rails || {};
  const explorer = data.explorer || {};
  const env = data.env || {};
  const checklist = data.env_checklist || [];

  const supplyHuman = chain.total_supply_human != null
    ? fmtNum(chain.total_supply_human, 4)
    : fmtNum(Number(env.max_total_supply || 0), 0);

  return (
    <div className="flex flex-col gap-5 w-full min-w-0">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-extrabold text-white flex items-center gap-2">
            <Coins className="text-gold-light" size={22} />
            Your token — {data.symbol || 'IBO'}
          </h2>
          <p className="text-sm text-white/55 mt-1">
            {data.network_display} · {data.standard} · matches BscScan token page
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-surface-border text-sm font-bold">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {canManage ? (
            <button type="button" onClick={reseed} disabled={busy} className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-gold/20 border border-gold/40 text-sm font-bold text-gold-light">
              <Database size={14} /> Apply .env &amp; seed
            </button>
          ) : null}
        </div>
      </div>

      {!data.seeded ? (
        <div className="rounded-xl border border-gold/35 bg-gold/10 px-4 py-3 text-sm text-gold-light/90 flex gap-2">
          <AlertTriangle size={18} className="shrink-0" />
          IBO is not seeded in the database yet. Set <code className="font-mono">IBO_CONTRACT_ADDRESS</code> and click Apply .env &amp; seed.
        </div>
      ) : null}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <GradientStatCard label="Max total supply" value={fmtNum(env.max_total_supply)} hint="Env / BscScan" tone="amber" />
        <GradientStatCard label="On-chain supply" value={supplyHuman} hint={`${chain.decimals ?? 18} decimals`} tone="cyan" />
        <GradientStatCard label="Holders" value={scan.holders != null ? fmtNum(scan.holders) : '—'} hint={scan.api_configured ? 'BscScan API' : 'Add BSCSCAN_API_KEY'} tone="emerald" />
        <GradientStatCard label="User deposit addresses" value={fmtNum(rails.user_deposit_address_count)} hint="HD per user" tone="violet" />
      </div>

      <AdminPanel title="Token identity" subtitle="Platform listing + live contract read">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <DetailCell label="Token name (on-chain)" value={chain.name || tok.token_name} />
          <DetailCell label="Symbol" value={chain.symbol || tok.token_symbol || data.symbol} mono />
          <DetailCell label="Project" value={tok.project_name || env.project_name} />
          <DetailCell label="Decimals" value={String(chain.decimals ?? env.decimals ?? 18)} />
          <DetailCell label="Network" value={tok.blockchain_network || env.blockchain_network} />
          <DetailCell label="Listing status">
            <StatusBadge tone={tok.status === 'approved' ? 'success' : 'warning'}>{tok.status || 'not seeded'}</StatusBadge>
          </DetailCell>
          <DetailCell label="Spot pair" value={tok.spot_symbol || `${data.symbol}USDT`} mono />
          <DetailCell label="Contract address" value={chain.contract_address || env.contract_address || tok.contract_address} mono />
          <DetailCell label="Listed token ID" value={tok.id} mono />
        </div>
      </AdminPanel>

      <AdminPanel title="Explorer & links" subtitle="Open on BscScan (same data as your screenshot)">
        <div className="flex flex-wrap gap-3">
          {Object.entries(explorer).map(([k, url]) => (
            <a
              key={k}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-cyan-500/30 bg-cyan-500/10 text-cyan-200 text-sm font-bold hover:bg-cyan-500/20"
            >
              <ExternalLink size={14} />
              {k.replace(/_/g, ' ')}
            </a>
          ))}
          {env.dex_swap_link ? (
            <a href={env.dex_swap_link} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold">
              <Link2 size={14} /> DEX
            </a>
          ) : null}
        </div>
        {scan.transfers != null ? (
          <p className="text-sm text-white/55 mt-4">Total transfers (BscScan): <strong className="text-white">{fmtNum(scan.transfers)}</strong></p>
        ) : null}
      </AdminPanel>

      <AdminPanel title="Deposit & trading controls" subtitle="Users receive a unique BEP-20 address via Wallet → Deposit IBO">
        <FilterBar className="!p-4 mb-4">
          <div className="flex flex-wrap gap-2 items-center">
            <TogglePill label="Deposits" on={!!tok.deposit_enabled} onClick={() => patchFlag('deposit_enabled')} disabled={!canManage} />
            <TogglePill label="Withdrawals" on={!!tok.withdraw_enabled} onClick={() => patchFlag('withdraw_enabled')} disabled={!canManage} />
            <TogglePill label="Trading" on={!!tok.trading_enabled} onClick={() => patchFlag('trading_enabled')} disabled={!canManage} />
          </div>
        </FilterBar>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <DetailCell label="BSC RPC">
            {rails.bsc_rpc_configured ? (
              <span className="text-emerald-300 text-sm flex items-center gap-1"><CheckCircle size={14} /> {rails.bsc_rpc_masked || 'Active'}</span>
            ) : rails.bsc_rpc_env_configured && rails.bsc_rpc_admin_enabled === false ? (
              <span className="text-gold-light text-sm">Disabled in Admin → Settings (enable BNB Smart Chain)</span>
            ) : rails.bsc_rpc_env_configured ? (
              <span className="text-gold-light text-sm">URL in .env but inactive — restart API after editing .env</span>
            ) : (
              <span className="text-rose-300 text-sm">Set QUICKNODE_BSC_URL in backend/.env and restart API</span>
            )}
          </DetailCell>
          <DetailCell label="Deposit scanner" value={rails.scan_group_active ? 'Active for IBO BEP-20' : 'Inactive — reseed or enable deposits'} />
          <DetailCell label="Scan contract" value={rails.scan_contract} mono />
          <DetailCell label="Deposit events (all time)" value={fmtNum(rails.deposit_event_count)} />
          <DetailCell label="Wallet API">
            <code className="text-xs text-cyan-300">{rails.wallet_api}</code>
          </DetailCell>
          <DetailCell label="How addresses are created">
            <span className="text-sm text-white/75">HD-derived per user when they open Wallet → Deposit → IBO → BEP-20. Requires mnemonic + QuickNode BSC.</span>
          </DetailCell>
        </div>
      </AdminPanel>

      <AdminPanel title="Environment checklist" subtitle="Required keys for live IBO deposits">
        <ul className="space-y-2">
          {checklist.map((row) => (
            <li key={row.key} className="flex items-center justify-between gap-3 text-sm py-2 border-b border-surface-border/40 last:border-0">
              <span className="font-mono text-white/80">{row.key}</span>
              <span className={row.ok ? 'text-emerald-300 font-bold' : 'text-gold-light font-bold'}>
                {row.ok ? 'OK' : row.set ? 'Check value' : 'Missing'}
              </span>
            </li>
          ))}
        </ul>
      </AdminPanel>

      {rails.recent_deposit_events?.length > 0 ? (
        <AdminPanel title="Recent IBO deposit sightings" subtitle="From deposit poller (auto-credit if enabled)">
          <div className="adm-table-x scrollbar-thin">
            <table className="admin-data-table min-w-[640px]">
              <thead>
                <tr>
                  <th className="px-4 py-2">Time</th>
                  <th className="px-4 py-2">Amount</th>
                  <th className="px-4 py-2">Address</th>
                  <th className="px-4 py-2">Tx</th>
                  <th className="px-4 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {rails.recent_deposit_events.map((ev) => (
                  <tr key={ev.id || ev.tx_hash}>
                    <td className="px-4 py-2 text-xs text-white/60">{ev.last_seen_at || ev.first_seen_at || '—'}</td>
                    <td className="px-4 py-2 font-mono text-gold-light">{ev.amount}</td>
                    <td className="px-4 py-2 font-mono text-xs truncate max-w-[140px]" title={ev.address}>{ev.address}</td>
                    <td className="px-4 py-2 font-mono text-xs truncate max-w-[120px]" title={ev.tx_hash}>{ev.tx_hash}</td>
                    <td className="px-4 py-2"><StatusBadge tone={ev.status === 'credited' ? 'success' : 'neutral'}>{ev.status}</StatusBadge></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Link to="/deposit-events" className="inline-block mt-3 text-sm text-gold-light font-semibold hover:underline">
            View all deposit events →
          </Link>
        </AdminPanel>
      ) : (
        <AdminPanel title="Deposit addresses" subtitle="No IBO deposit events yet">
          <p className="text-sm text-white/55 flex items-start gap-2">
            <Wallet size={16} className="shrink-0 mt-0.5 text-gold-light" />
            {rails.user_deposit_address_count > 0
              ? `${rails.user_deposit_address_count} user deposit address(es) exist. Events appear when users send IBO to those addresses.`
              : 'No user has generated a IBO deposit address yet. Log in on the exchange, open Wallet → Deposit → IBO → BEP-20 (BNB Chain).'}
          </p>
        </AdminPanel>
      )}

      {chain.read_errors?.length > 0 ? (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
          <Shield size={16} className="inline mr-2" />
          On-chain read: {chain.read_errors.join('; ')}
        </div>
      ) : null}
    </div>
  );
}
