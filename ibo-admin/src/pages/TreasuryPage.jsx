import { useEffect, useMemo, useState, Fragment } from 'react';
import { Link } from 'react-router-dom';
import { Landmark, ShieldAlert, Wallet, RefreshCw, ChevronDown, ChevronRight, ChevronLeft, X } from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import CoinAvatar from '@/components/CoinAvatar';
import UserUidSuggestInput from '@/components/UserUidSuggestInput';
import { AdminPageHeader, AdminPanel, GradientStatCard } from '@/components/AdminPrimitives';

function fmtUsd(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  const sign = v < 0 ? '-' : '';
  const abs = Math.abs(v);
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}

function fmtNum(n, dp = 8) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}

function fmtTs(iso) {
  if (!iso) return '—';
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
}

const USER_PAGE_SIZES = [10, 25, 50, 100];

const USER_SORT_OPTIONS = [
  { value: 'total_usd:desc', label: 'Est. USD (high → low)' },
  { value: 'total_usd:asc', label: 'Est. USD (low → high)' },
  { value: 'events:desc', label: 'Deposit events (most)' },
  { value: 'events:asc', label: 'Deposit events (fewest)' },
  { value: 'last_credited:desc', label: 'Last credited (newest)' },
  { value: 'last_credited:asc', label: 'Last credited (oldest)' },
  { value: 'uid:asc', label: 'User ID (A → Z)' },
  { value: 'uid:desc', label: 'User ID (Z → A)' },
];

const inputClass = 'rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white placeholder-white/40 focus:outline-none focus:border-gold/50';
const selectClass = inputClass;

export default function TreasuryPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_treasury');

  const [data, setData]           = useState(null);
  const [depData, setDepData]     = useState(null);
  const [err, setErr]             = useState('');
  const [loading, setLoading]     = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [syncing, setSyncing]     = useState(false);
  const [syncMsg, setSyncMsg]     = useState('');
  const [activeTab, setActiveTab] = useState('overview');
  const [expandedUids, setExpandedUids] = useState({});
  const [userSearch, setUserSearch] = useState('');
  const [uidFilter, setUidFilter] = useState('');
  const [assetFilter, setAssetFilter] = useState('');
  const [minUsdFilter, setMinUsdFilter] = useState('');
  const [userSort, setUserSort] = useState('total_usd:desc');
  const [userPage, setUserPage] = useState(1);
  const [userPageSize, setUserPageSize] = useState(25);

  const load = async () => {
    setRefreshing(true);
    setErr('');
    try {
      const [r1, r2] = await Promise.all([
        api.treasury(),
        api.treasuryDepositSummary(),
      ]);
      const j1 = await r1.json().catch(() => ({}));
      const j2 = await r2.json().catch(() => ({}));
      if (!r1.ok) throw new Error(j1?.detail || 'Failed to load treasury');
      if (!r2.ok) throw new Error(j2?.detail || 'Failed to load deposit summary');
      setData(j1);
      setDepData(j2);
    } catch (e) {
      setErr(String(e?.message || e || 'Failed to load treasury'));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    load();
    const id = setInterval(load, 30_000);
    return () => clearInterval(id);
  }, []);

  const syncCustody = async () => {
    setSyncing(true); setSyncMsg(''); setErr('');
    try {
      const res = await api.treasurySyncCustody();
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json?.detail || 'Sync failed');
      const n = (json.adjustments || []).length;
      setSyncMsg(n ? `Synced ${n} asset(s) from deposit history.` : 'Already up to date.');
      await load();
    } catch (e) {
      setErr(String(e?.message || e || 'Sync failed'));
    } finally {
      setSyncing(false);
    }
  };

  const positions    = data?.positions || [];
  const totals       = data?.totals || {};
  const revenue      = data?.revenue || {};
  const custody      = data?.custody || {};
  const limits       = data?.limits || {};
  const provider     = data?.provider || {};

  const depAssets    = depData?.asset_totals || [];
  const depGrandUsd  = depData?.grand_total_usd;
  const depUserRows  = depData?.user_rows || [];
  const custodyRows  = custody?.rows || [];
  const custodyGapUsd = Number(custody?.sync_gap_usd) || 0;

  const markByAsset = useMemo(() => {
    const m = {};
    for (const a of depAssets) {
      m[a.asset] = a.asset === 'USDT' ? 1 : Number(a.mark_price_usdt) || 0;
    }
    return m;
  }, [depAssets]);

  const userSummaries = useMemo(() => {
    const m = {};
    for (const r of depUserRows) {
      if (!m[r.uid]) {
        m[r.uid] = { uid: r.uid, rows: [], eventCount: 0, totalUsd: 0, lastCredited: null };
      }
      const entry = m[r.uid];
      entry.rows.push(r);
      entry.eventCount += Number(r.event_count) || 0;
      const mark = markByAsset[r.asset] ?? (r.asset === 'USDT' ? 1 : 0);
      entry.totalUsd += (Number(r.total_deposited) || 0) * mark;
      const ts = r.last_credited_at;
      if (ts && (!entry.lastCredited || new Date(ts) > new Date(entry.lastCredited))) {
        entry.lastCredited = ts;
      }
    }
    return Object.values(m).sort((a, b) => b.totalUsd - a.totalUsd);
  }, [depUserRows, markByAsset]);

  const depositAssetOptions = useMemo(
    () => [...new Set(depUserRows.map(r => r.asset).filter(Boolean))].sort(),
    [depUserRows],
  );

  const filteredUserSummaries = useMemo(() => {
    const q = userSearch.trim().toLowerCase();
    const uidQ = uidFilter.trim().toLowerCase();
    const asset = assetFilter.trim().toUpperCase();
    const minUsd = minUsdFilter.trim() ? Number(minUsdFilter) : null;
    const [sortKey, sortDir] = userSort.split(':');

    const rows = userSummaries.filter(u => {
      if (uidQ && !u.uid.toLowerCase().includes(uidQ)) return false;
      if (q) {
        const uidMatch = u.uid.toLowerCase().includes(q);
        const assetMatch = u.rows.some(r => r.asset.toLowerCase().includes(q));
        if (!uidMatch && !assetMatch) return false;
      }
      if (asset && !u.rows.some(r => r.asset === asset)) return false;
      if (minUsd != null && Number.isFinite(minUsd) && u.totalUsd < minUsd) return false;
      return true;
    });

    const dir = sortDir === 'asc' ? 1 : -1;
    return [...rows].sort((a, b) => {
      let cmp = 0;
      switch (sortKey) {
        case 'uid':
          cmp = a.uid.localeCompare(b.uid);
          break;
        case 'events':
          cmp = a.eventCount - b.eventCount;
          break;
        case 'last_credited':
          cmp = new Date(a.lastCredited || 0) - new Date(b.lastCredited || 0);
          break;
        case 'total_usd':
        default:
          cmp = a.totalUsd - b.totalUsd;
          break;
      }
      return cmp * dir;
    });
  }, [userSummaries, userSearch, uidFilter, assetFilter, minUsdFilter, userSort]);

  const hasUserFilters = Boolean(
    userSearch.trim() || uidFilter.trim() || assetFilter.trim() || minUsdFilter.trim()
      || userSort !== 'total_usd:desc',
  );

  const clearUserFilters = () => {
    setUserSearch('');
    setUidFilter('');
    setAssetFilter('');
    setMinUsdFilter('');
    setUserSort('total_usd:desc');
    setUserPage(1);
  };

  const userTotalPages = Math.max(1, Math.ceil(filteredUserSummaries.length / userPageSize));

  const pagedUserSummaries = useMemo(() => {
    const start = (userPage - 1) * userPageSize;
    return filteredUserSummaries.slice(start, start + userPageSize);
  }, [filteredUserSummaries, userPage, userPageSize]);

  useEffect(() => {
    setUserPage(1);
  }, [userSearch, uidFilter, assetFilter, minUsdFilter, userSort, userPageSize]);

  useEffect(() => {
    if (userPage > userTotalPages) setUserPage(userTotalPages);
  }, [userPage, userTotalPages]);

  const sortedPositions = useMemo(() =>
    [...positions].sort((a, b) => Math.abs(Number(b.usd_value) || 0) - Math.abs(Number(a.usd_value) || 0)),
    [positions]);

  const shortAssets = sortedPositions.filter(p => p.is_short);

  const toggleUid = (uid) =>
    setExpandedUids(prev => ({ ...prev, [uid]: !prev[uid] }));

  return (
    <div className="admin-page">
      <AdminPageHeader
        icon={Landmark}
        title="Treasury"
        subtitle="Real on-chain deposit totals per user, plus house inventory from SYSTEM trading."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            {canManage ? (
              <button type="button" onClick={syncCustody} disabled={syncing || refreshing}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gold/40 text-sm font-bold text-gold-light hover:bg-gold/10 disabled:opacity-50">
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} />
                Sync custody
              </button>
            ) : null}
            <Link to="/treasury-omnibus"
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gold/30 text-sm font-bold text-gold-light hover:bg-gold/10">
              <Wallet size={14} /> Hot & cold wallets
            </Link>
            <button type="button" onClick={load} disabled={refreshing}
              className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-surface-border text-sm font-bold text-white/85 hover:text-white hover:border-gold/40 disabled:opacity-50">
              <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>
        )}
      />

      <p className="admin-page-lead mb-6">
        <strong className="text-white/90">Deposit totals</strong> on the Overview tab come from the same source as the Deposits page — only real on-chain credits (<code>status=credited</code>). Per-user breakdown is on the <strong className="text-white/90">Deposits by user</strong> tab.{' '}
        <strong className="text-white/90">House inventory</strong> further down tracks net SYSTEM trading positions.
        <strong className="text-white/90"> Custody reserves</strong> show what the treasury ledger should hold from user deposits (use Sync custody if mirrored totals lag).{' '}
        On-chain addresses: <Link to="/treasury-omnibus" className="text-gold-light font-semibold hover:underline">Hot & cold wallets</Link>.
      </p>

      {syncMsg ? (
        <div className="mb-4 rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 text-emerald-200 text-sm">{syncMsg}</div>
      ) : null}
      {err ? (
        <div className="mb-4 rounded-xl border border-red-500/40 bg-red-500/10 p-3 text-red-200 text-sm">{err}</div>
      ) : null}
      {!provider.configured ? (
        <div className="mb-4 rounded-xl border border-gold/40 bg-gold/10 p-3 text-gold-light text-xs flex items-start gap-2">
          <ShieldAlert size={16} className="shrink-0 mt-0.5" />
          <span>Blockchain provider not configured — on-chain custody tracking unavailable.</span>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2 mb-6 border-b border-surface-border pb-3">
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`admin-tab-btn shrink-0 ${activeTab === 'overview' ? 'active' : ''}`}
        >
          Overview
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('by-user')}
          className={`admin-tab-btn shrink-0 ${activeTab === 'by-user' ? 'active' : ''}`}
        >
          Deposits by user
          {userSummaries.length > 0 ? (
            <span className="ml-1.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md bg-white/10 text-white/70">
              {userSummaries.length}
            </span>
          ) : null}
        </button>
      </div>

      {activeTab === 'overview' ? (
        <>
      {/* KPI row */}
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 mb-8">
        <GradientStatCard label="Real deposits (USD)" value={fmtUsd(depGrandUsd)} hint="Sum of credited on-chain deposits only" tone="cyan" />
        <GradientStatCard label="Long exposure (USD)" value={fmtUsd(totals.long_usdt)} hint="House inventory rows where balance > 0" tone="emerald" />
        <GradientStatCard label="Short exposure (USD)" value={fmtUsd(totals.short_usdt)} hint="Negative = owed inventory" tone="rose" />
        <GradientStatCard label="Spread revenue (USDT)" value={fmtUsd(revenue.spread_total_usdt)} hint={`${revenue.spread_fill_count || 0} SYSTEM fills since cutover`} tone="amber" />
      </div>

      {/* Asset totals from deposits */}
      <h2 className="text-lg font-extrabold text-white mb-3">Credited deposits — asset totals</h2>
      <div className="rounded-2xl border border-surface-border bg-surface-card adm-table-x scrollbar-thin min-w-0 mb-6">
        <table className="w-full text-sm min-w-[480px]">
          <thead>
            <tr className="text-left text-sm font-semibold text-white/75 border-b border-surface-border bg-white/[.02]">
              <th className="px-4 py-3">Asset</th>
              <th className="px-4 py-3 text-right">Total deposited</th>
              <th className="px-4 py-3 text-right">Mark (USDT)</th>
              <th className="px-4 py-3 text-right">USD value</th>
            </tr>
          </thead>
          <tbody>
            {loading && depAssets.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-white/45">Loading…</td></tr>
            ) : depAssets.length === 0 ? (
              <tr><td colSpan={4} className="px-4 py-8 text-center text-white/45">No credited deposits yet.</td></tr>
            ) : (
              depAssets.map(row => (
                <tr key={row.asset} className="border-b border-surface-border/50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 font-bold text-white">
                      <CoinAvatar asset={row.asset} className="h-6 w-6" />
                      {row.asset}
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono text-right text-cyan-200">{fmtNum(row.total_deposited)}</td>
                  <td className="px-4 py-3 font-mono text-right text-white/70">
                    {row.asset === 'USDT' ? '1.0000' : fmtNum(row.mark_price_usdt, 6)}
                  </td>
                  <td className="px-4 py-3 font-mono text-right text-white/80">{fmtUsd(row.usd_value)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Custody reserves (mirrored deposit liabilities) */}
      <h2 className="text-lg font-extrabold text-white mb-2">Custody reserves (user deposits)</h2>
      <p className="text-white/50 text-sm mb-4">
        Expected treasury holdings from credited on-chain deposits minus confirmed withdrawals.
        Mirrored net is what the treasury ledger records — click Sync custody if gaps appear.
      </p>
      {Math.abs(custodyGapUsd) >= 0.01 ? (
        <div className="mb-4 rounded-2xl border border-gold/30 bg-gold/[.06] p-4">
          <p className="text-gold-light font-extrabold text-sm flex items-center gap-2 mb-1">
            <ShieldAlert size={16} /> Custody ledger gap: {fmtUsd(custodyGapUsd)}
          </p>
          <p className="text-gold-light/90/70 text-xs">
            Expected deposit custody exceeds mirrored treasury rows — run Sync custody to backfill.
          </p>
        </div>
      ) : null}
      <div className="rounded-2xl border border-surface-border bg-surface-card adm-table-x scrollbar-thin min-w-0 mb-6">
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-sm font-semibold text-white/75 border-b border-surface-border bg-white/[.02]">
              <th className="px-4 py-3">Asset</th>
              <th className="px-4 py-3 text-right">Expected net</th>
              <th className="px-4 py-3 text-right">Mirrored net</th>
              <th className="px-4 py-3 text-right">Sync gap</th>
              <th className="px-4 py-3 text-right">Mark (USDT)</th>
              <th className="px-4 py-3 text-right">Expected USD</th>
            </tr>
          </thead>
          <tbody>
            {loading && custodyRows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-white/45">Loading…</td></tr>
            ) : custodyRows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-8 text-center text-white/45">No credited deposit custody yet.</td></tr>
            ) : (
              custodyRows.map(row => {
                const gap = Number(row.sync_gap) || 0;
                const gapClass = Math.abs(gap) >= 1e-8 ? 'text-gold-light' : 'text-white/50';
                return (
                  <tr key={row.asset} className="border-b border-surface-border/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-bold text-white">
                        <CoinAvatar asset={row.asset} className="h-6 w-6" />
                        {row.asset}
                      </div>
                    </td>
                    <td className="px-4 py-3 font-mono text-right text-cyan-200">{fmtNum(row.expected_net)}</td>
                    <td className="px-4 py-3 font-mono text-right text-white/80">{fmtNum(row.mirrored_net)}</td>
                    <td className={`px-4 py-3 font-mono text-right ${gapClass}`}>{fmtNum(row.sync_gap)}</td>
                    <td className="px-4 py-3 font-mono text-right text-white/70">
                      {row.asset === 'USDT' ? '1.0000' : fmtNum(row.mark_price_usdt, 6)}
                    </td>
                    <td className="px-4 py-3 font-mono text-right text-white/80">{fmtUsd(row.expected_usd)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* House inventory */}
      <h2 className="text-lg font-extrabold text-white mb-2">House inventory (SYSTEM trading)</h2>
      <p className="text-white/50 text-sm mb-4">Net positions from market-making. All zeros until users trade against the house.</p>

      {shortAssets.length > 0 && (
        <div className="mb-4 rounded-2xl border border-red-500/30 bg-red-500/[.06] p-4">
          <p className="text-red-200 font-extrabold text-sm flex items-center gap-2 mb-1">
            <ShieldAlert size={16} /> Treasury short on {shortAssets.length} asset(s)
          </p>
          <p className="text-red-100/70 text-xs">Platform owes these assets to users — unhedged exposure.</p>
        </div>
      )}

      <div className="rounded-2xl border border-surface-border bg-surface-card adm-table-x scrollbar-thin min-w-0 mb-6">
        <table className="w-full text-sm min-w-[860px]">
          <thead>
            <tr className="text-left text-sm font-semibold text-white/75 border-b border-surface-border bg-white/[.02]">
              <th className="px-4 py-3">Asset</th>
              <th className="px-4 py-3 text-right">Net position</th>
              <th className="px-4 py-3 text-right">Mark (USDT)</th>
              <th className="px-4 py-3 text-right">USD value</th>
              <th className="px-4 py-3 text-right">Limit (base)</th>
              <th className="px-4 py-3 text-right">Utilisation</th>
              <th className="px-4 py-3 text-right">Spread (bps)</th>
              <th className="px-4 py-3 text-right">SYSTEM fills</th>
            </tr>
          </thead>
          <tbody>
            {loading && positions.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-white/45">Loading…</td></tr>
            ) : sortedPositions.length === 0 ? (
              <tr><td colSpan={8} className="px-4 py-12 text-center text-white/45">No house positions yet.</td></tr>
            ) : (
              sortedPositions.map(p => {
                const net = Number(p.net_position) || 0;
                const netClass = net < 0 ? 'text-red-300' : net > 0 ? 'text-green-300' : 'text-white/60';
                const util = p.utilisation_pct;
                const utilClass = util == null ? 'text-white/40' : util >= 90 ? 'text-red-300' : util >= 60 ? 'text-gold-light' : 'text-white/70';
                return (
                  <tr key={p.asset} className="border-b border-surface-border/50">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2 font-bold text-white">
                        <CoinAvatar asset={p.asset} className="h-6 w-6" />
                        {p.asset}
                      </div>
                    </td>
                    <td className={`px-4 py-3 font-mono text-right ${netClass}`}>{fmtNum(p.net_position)}</td>
                    <td className="px-4 py-3 font-mono text-right text-white/70">
                      {p.asset === 'USDT' ? '1.0000' : fmtNum(p.mark_price_usdt, 6)}
                    </td>
                    <td className={`px-4 py-3 font-mono text-right ${netClass}`}>{fmtUsd(p.usd_value)}</td>
                    <td className="px-4 py-3 font-mono text-right text-white/70">{p.limit_base != null ? fmtNum(p.limit_base, 4) : '—'}</td>
                    <td className={`px-4 py-3 font-mono text-right ${utilClass}`}>{util != null ? `${util.toFixed(1)}%` : '—'}</td>
                    <td className="px-4 py-3 font-mono text-right text-white/70">{Number(p.spread_bps || 0).toFixed(1)}</td>
                    <td className="px-4 py-3 font-mono text-right text-white/60 text-xs">
                      <span className="text-green-300/80">+{fmtNum(p.fills_inflow, 4)}</span>
                      {' / '}
                      <span className="text-red-300/80">-{fmtNum(p.fills_outflow, 4)}</span>
                      <div className="text-white/40">{p.fill_legs} legs</div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-white/90 text-base font-semibold mb-2">Extra spread by pair</p>
          {Object.keys(limits.spread_bps_by_symbol || {}).length === 0 ? (
            <p className="text-white/65 text-sm">Default {limits.spread_bps_default ?? 0} bps on all pairs.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {Object.entries(limits.spread_bps_by_symbol).map(([sym, bps]) => (
                <li key={sym} className="flex justify-between font-mono">
                  <span className="text-white/80">{sym}</span>
                  <span className="text-gold-light">{bps} bps</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="rounded-2xl border border-surface-border bg-surface-card p-4">
          <p className="text-white/90 text-base font-semibold mb-2">Max position size per pair</p>
          {Object.keys(limits.inventory_limit_base || {}).length === 0 ? (
            <p className="text-white/65 text-sm">No per-pair limits set.</p>
          ) : (
            <ul className="text-sm space-y-1">
              {Object.entries(limits.inventory_limit_base).map(([sym, qty]) => (
                <li key={sym} className="flex justify-between font-mono">
                  <span className="text-white/80">{sym}</span>
                  <span className="text-white/70">±{fmtNum(qty, 6)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
        </>
      ) : (
        <>
          <p className="text-white/50 text-sm mb-4">
            One row per user with credited on-chain deposits. Expand a row to see per-asset breakdown.
          </p>

          <AdminPanel
            title="Search & filters"
            right={hasUserFilters ? (
              <button
                type="button"
                onClick={clearUserFilters}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-white/60 hover:text-white"
              >
                <X size={14} /> Clear all
              </button>
            ) : null}
            className="mb-4"
          >
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
              <input
                type="text"
                value={userSearch}
                onChange={e => setUserSearch(e.target.value)}
                placeholder="Search UID or asset…"
                className={inputClass}
              />
              <UserUidSuggestInput
                value={uidFilter}
                onChange={setUidFilter}
                placeholder="Filter UID"
                className={`w-full font-mono ${inputClass}`}
              />
              <select
                value={assetFilter}
                onChange={e => setAssetFilter(e.target.value)}
                className={selectClass}
              >
                <option value="">All assets</option>
                {depositAssetOptions.map(ast => (
                  <option key={ast} value={ast}>{ast}</option>
                ))}
              </select>
              <input
                type="number"
                min="0"
                step="any"
                value={minUsdFilter}
                onChange={e => setMinUsdFilter(e.target.value)}
                placeholder="Min est. USD"
                className={inputClass}
              />
              <select
                value={userSort}
                onChange={e => setUserSort(e.target.value)}
                className={selectClass}
              >
                {USER_SORT_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <select
                value={userPageSize}
                onChange={e => setUserPageSize(Number(e.target.value))}
                className={selectClass}
              >
                {USER_PAGE_SIZES.map(n => (
                  <option key={n} value={n}>{n} / page</option>
                ))}
              </select>
            </div>
          </AdminPanel>

          <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
            <h2 className="text-lg font-extrabold text-white">
              Depositors
              <span className="ml-2 text-sm font-normal text-white/45">
                {filteredUserSummaries.length} of {userSummaries.length} user{userSummaries.length !== 1 ? 's' : ''}
              </span>
            </h2>
          </div>

          <div className="rounded-2xl border border-surface-border bg-surface-card adm-table-x scrollbar-thin min-w-0 mb-4">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="text-left text-sm font-semibold text-white/75 border-b border-surface-border bg-white/[.02]">
                  <th className="px-4 py-3 w-8" />
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3 text-right">Assets deposited</th>
                  <th className="px-4 py-3 text-right">Deposit events</th>
                  <th className="px-4 py-3 text-right">Est. USD</th>
                  <th className="px-4 py-3 text-right">Last credited</th>
                </tr>
              </thead>
              <tbody>
                {loading && pagedUserSummaries.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-white/45">Loading…</td></tr>
                ) : pagedUserSummaries.length === 0 ? (
                  <tr><td colSpan={6} className="px-4 py-8 text-center text-white/45">
                    {userSummaries.length === 0 ? 'No deposit records found.' : 'No users match these filters.'}
                  </td></tr>
                ) : (
                  pagedUserSummaries.map(user => {
                    const expanded = !!expandedUids[user.uid];
                    const assetList = user.rows.map(r => r.asset).join(', ');
                    return (
                      <Fragment key={user.uid}>
                        <tr className="border-b border-surface-border/50 hover:bg-white/[.02]">
                          <td className="px-4 py-3">
                            <button
                              type="button"
                              onClick={() => toggleUid(user.uid)}
                              className="text-white/50 hover:text-white/80"
                              aria-label={expanded ? 'Collapse' : 'Expand'}
                            >
                              {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                            </button>
                          </td>
                          <td className="px-4 py-3">
                            <Link
                              to={`/users/${encodeURIComponent(user.uid)}`}
                              className="font-mono text-sm text-gold-light hover:underline"
                            >
                              {user.uid}
                            </Link>
                          </td>
                          <td className="px-4 py-3 text-right text-white/60 text-xs max-w-[220px] truncate" title={assetList}>
                            {assetList}
                          </td>
                          <td className="px-4 py-3 font-mono text-right text-white/70">{user.eventCount}</td>
                          <td className="px-4 py-3 font-mono text-right text-cyan-200">{fmtUsd(user.totalUsd)}</td>
                          <td className="px-4 py-3 font-mono text-right text-white/50 text-xs">{fmtTs(user.lastCredited)}</td>
                        </tr>
                        {expanded ? (
                          <tr className="border-b border-surface-border/50 bg-white/[.015]">
                            <td />
                            <td colSpan={5} className="px-4 py-2">
                              <table className="w-full text-xs">
                                <thead>
                                  <tr className="text-white/45">
                                    <th className="text-left pb-1 font-semibold">Asset</th>
                                    <th className="text-right pb-1 font-semibold">Total deposited</th>
                                    <th className="text-right pb-1 font-semibold">Events</th>
                                    <th className="text-right pb-1 font-semibold">Last credited</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {user.rows.map(r => (
                                    <tr key={r.asset} className="border-t border-surface-border/25">
                                      <td className="py-1.5">
                                        <div className="flex items-center gap-2">
                                          <CoinAvatar asset={r.asset} className="h-4 w-4" />
                                          <span className="font-bold text-white">{r.asset}</span>
                                        </div>
                                      </td>
                                      <td className="py-1.5 font-mono text-right text-cyan-200">{fmtNum(r.total_deposited)}</td>
                                      <td className="py-1.5 font-mono text-right text-white/60">{r.event_count}</td>
                                      <td className="py-1.5 font-mono text-right text-white/50">{fmtTs(r.last_credited_at)}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </td>
                          </tr>
                        ) : null}
                      </Fragment>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {filteredUserSummaries.length > userPageSize ? (
            <div className="flex items-center justify-between text-sm text-white/60">
              <div>
                Showing{' '}
                <span className="text-white/85 font-bold">
                  {(userPage - 1) * userPageSize + 1}
                  –
                  {Math.min(userPage * userPageSize, filteredUserSummaries.length)}
                </span>{' '}
                of {filteredUserSummaries.length}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setUserPage(p => Math.max(1, p - 1))}
                  disabled={userPage <= 1}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 text-white/75 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <ChevronLeft size={14} /> Prev
                </button>
                <span className="text-white/50">
                  Page <span className="text-white/85 font-bold">{userPage}</span> / {userTotalPages}
                </span>
                <button
                  type="button"
                  onClick={() => setUserPage(p => Math.min(userTotalPages, p + 1))}
                  disabled={userPage >= userTotalPages}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md border border-white/10 text-white/75 hover:bg-white/5 disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  Next <ChevronRight size={14} />
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
