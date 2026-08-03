import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Wallet, Search, TrendingUp, ArrowLeftRight } from 'lucide-react';
import { api } from '@/lib/api';
import { useListSort } from '@/lib/useListSort';
import SortableTh from '@/components/SortableTh';
import ConfirmModal from '@/components/ConfirmModal';
import UserUidSuggestInput from '@/components/UserUidSuggestInput';
import CoinAvatar from '@/components/CoinAvatar';

const SPOT_ASSETS = ['USDT', 'IBO', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'DOGE', 'ADA', 'POL', 'AVAX', 'DOT', 'LINK', 'LTC'];

/**
 * Wallet Management — operator console.
 *
 * The page now spans BOTH ledgers:
 *   • Spot     → ``wallet_txns``           (multi-asset, existing endpoint)
 *   • Futures  → ``futures_wallet_txns``    (USDT-only margin ledger)
 *
 * The venue is a top-level tab. Each venue has its own create-adjustment
 * form, history table, totals, and balance-after column. Filters and
 * sorting persist independently so an admin can flip between the two
 * without losing context.
 */
export default function WalletAdjustmentsPage() {
  const [searchParams] = useSearchParams();
  const initialVenue = searchParams.get('venue') === 'futures' ? 'futures' : 'spot';
  const [venue, setVenue] = useState(initialVenue);

  return (
    <div className="admin-page">
      <h1 className="admin-title mb-2 flex flex-wrap items-center gap-2">
        <Wallet className="text-gold-light shrink-0" size={28} />
        Wallet Management
      </h1>
      <p className="admin-page-lead mb-4">
        Inspect and adjust user balances across the <strong>spot</strong> and
        <strong> futures</strong> ledgers. Every change is written with your
        admin email and a mandatory reason for the audit trail.
      </p>

      {/* Venue tabs */}
      <div className="flex items-center gap-1 border-b border-surface-border mb-5">
        {[
          { id: 'spot',    label: 'Spot wallets',    Icon: Wallet,
            hint: 'wallet_txns · all listed assets' },
          { id: 'futures', label: 'Futures wallets', Icon: TrendingUp,
            hint: 'futures_wallet_txns · USDT margin' },
        ].map(({ id, label, Icon, hint }) => {
          const active = venue === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => setVenue(id)}
              className={`px-4 py-2.5 inline-flex items-center gap-2 text-sm font-bold whitespace-nowrap transition-colors ${
                active
                  ? 'text-gold-light border-b-2 border-gold-light'
                  : 'text-white/55 hover:text-white border-b-2 border-transparent'
              }`}
              title={hint}
            >
              <Icon size={14} /> {label}
            </button>
          );
        })}
      </div>

      {venue === 'spot' ? <SpotWalletPanel /> : <FuturesWalletPanel />}
    </div>
  );
}

// ─── Spot panel (former WalletAdjustmentsPage body) ────────────────────────
function SpotWalletPanel() {
  const [searchParams] = useSearchParams();
  const [uid, setUid] = useState('');
  const [asset, setAsset] = useState('USDT');
  const [direction, setDirection] = useState('credit');
  const [amount, setAmount] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState('');
  const [err, setErr] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [stats, setStats] = useState({ credit_total: 0, debit_total: 0, net_delta: 0 });
  const [loading, setLoading] = useState(true);
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(25);
  const [q, setQ] = useState('');
  const [uidFilter, setUidFilter] = useState(searchParams.get('uid') || '');
  const [assetFilter, setAssetFilter] = useState('');
  const [directionFilter, setDirectionFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const { sortBy, sortDir, sortParams, toggleSort: _toggleSort, resetSort } = useListSort('created_at', 'desc');
  const toggleSort = useCallback((key) => {
    setSkip(0);
    _toggleSort(key);
  }, [_toggleSort]);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (q.trim()) params.q = q.trim();
      if (uidFilter.trim()) params.uid = uidFilter.trim();
      if (assetFilter) params.asset = assetFilter;
      if (directionFilter) params.direction = directionFilter;
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      Object.assign(params, sortParams);

      const r = await api.walletAdjustments(params);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not load wallet adjustment history');
      setItems(j.items || []);
      setTotal(j.total ?? 0);
      setStats(j.stats || { credit_total: 0, debit_total: 0, net_delta: 0 });
    } catch (e) {
      setErr(e.message);
      setItems([]);
      setTotal(0);
      setStats({ credit_total: 0, debit_total: 0, net_delta: 0 });
    } finally {
      setLoading(false);
    }
  }, [skip, limit, q, uidFilter, assetFilter, directionFilter, dateFrom, dateTo, sortParams]);

  useEffect(() => { load(); }, [load]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page  = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

  const submitAdjustment = async () => {
    if (!uid.trim()) { setErr('User UID is required'); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setErr('Amount must be greater than zero'); return; }
    setBusy(true); setErr(''); setOkMsg('');
    try {
      const r = await api.adjustUserWallet(uid.trim(), {
        direction, asset, amount: amt,
        note: note.trim() || undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Wallet adjustment failed');
      setOkMsg(`${direction === 'credit' ? 'Added' : 'Reduced'} ${amt} ${asset} for ${uid.trim()}`);
      setAmount(''); setNote(''); setSkip(0);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      {err   && <p className="text-red-400 text-sm mb-4">{err}</p>}
      {okMsg && <p className="text-green-400 text-sm mb-4">{okMsg}</p>}

      <div className="admin-section p-4 sm:p-5 mb-6 min-w-0">
        <p className="text-base font-semibold text-white mb-4">Create wallet adjustment (Spot)</p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <UserUidSuggestInput
              value={uid} onChange={setUid} placeholder="User UID"
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
            />
          </div>
          <select value={asset} onChange={(e) => setAsset(e.target.value)} className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white">
            {SPOT_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white">
            <option value="credit">Add (credit)</option>
            <option value="debit">Reduce (debit)</option>
          </select>
          <input type="number" min="0" step="0.00000001" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="Amount"
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono" />
          <button type="button" disabled={busy} onClick={() => setConfirmOpen(true)}
            className={`rounded-xl px-4 py-2 text-sm font-bold border disabled:opacity-40 ${
              direction === 'debit'
                ? 'border-red-500/30 text-red-300 bg-red-500/10'
                : 'border-green-500/30 text-green-300 bg-green-500/10'
            }`}>
            {direction === 'debit' ? 'Reduce balance' : 'Add balance'}
          </button>
        </div>
        <div className="mt-3">
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Reason / note (optional)"
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white" />
        </div>
      </div>

      <div className="admin-filter-bar mb-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-7 gap-3">
          <div className="lg:col-span-2 relative">
            <Search size={14} className="absolute left-3 top-3.5 text-white/45" />
            <input value={q} onChange={(e) => { setSkip(0); setQ(e.target.value); }}
              placeholder="Search uid/asset/admin/note/id"
              className="w-full rounded-xl bg-surface-dark border border-surface-border pl-8 pr-3 py-2 text-sm text-white" />
          </div>
          <UserUidSuggestInput value={uidFilter}
            onChange={(v) => { setSkip(0); setUidFilter(v); }} placeholder="Filter UID"
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono" />
          <select value={assetFilter} onChange={(e) => { setSkip(0); setAssetFilter(e.target.value); }} className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white">
            <option value="">All assets</option>
            {SPOT_ASSETS.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select value={directionFilter} onChange={(e) => { setSkip(0); setDirectionFilter(e.target.value); }} className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white">
            <option value="">All types</option>
            <option value="credit">Credit</option>
            <option value="debit">Debit</option>
          </select>
          <input type="date" value={dateFrom} onChange={(e) => { setSkip(0); setDateFrom(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white" />
          <input type="date" value={dateTo} onChange={(e) => { setSkip(0); setDateTo(e.target.value); }}
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white" />
        </div>
        <div className="mt-3">
          <button type="button" onClick={() => {
              setSkip(0); setQ(''); setUidFilter(''); setAssetFilter('');
              setDirectionFilter(''); setDateFrom(''); setDateTo(''); resetSort();
            }}
            className="rounded-xl border border-surface-border px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/[.04]">
            Clear filters
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4 text-sm text-white/65">
        <span>Total records: <strong className="text-white">{total}</strong></span>
        <span>Total added: <strong className="text-green-400 font-mono">{Number(stats.credit_total || 0).toFixed(6)}</strong></span>
        <span>Total reduced: <strong className="text-red-300 font-mono">{Number(stats.debit_total || 0).toFixed(6)}</strong></span>
        <span>Net delta: <strong className={`${Number(stats.net_delta || 0) >= 0 ? 'text-green-300' : 'text-red-300'} font-mono`}>{Number(stats.net_delta || 0).toFixed(6)}</strong></span>
      </div>

      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden min-w-0">
        <div className="adm-table-x scrollbar-thin">
          <table className="w-full text-sm min-w-[1050px]">
            <thead>
              <tr className="text-left text-sm font-semibold text-white/80 border-b border-surface-border bg-white/[.02]">
                <SortableTh className="px-4 py-3" sortKey="id"         activeKey={sortBy} dir={sortDir} onSort={toggleSort}>ID</SortableTh>
                <SortableTh className="px-4 py-3" sortKey="uid"        activeKey={sortBy} dir={sortDir} onSort={toggleSort}>User</SortableTh>
                <SortableTh className="px-4 py-3" sortKey="asset"      activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Asset</SortableTh>
                <SortableTh className="px-4 py-3" sortKey="direction"  activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Type</SortableTh>
                <SortableTh className="px-4 py-3" sortKey="amount"     activeKey={sortBy} dir={sortDir} onSort={toggleSort} align="right">Amount</SortableTh>
                <th className="px-4 py-3 text-right">Before {'->'} After</th>
                <th className="px-4 py-3">Admin</th>
                <th className="px-4 py-3">Note</th>
                <SortableTh className="px-4 py-3" sortKey="created_at" activeKey={sortBy} dir={sortDir} onSort={toggleSort}>Created</SortableTh>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-white/50">Loading…</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-16 text-center text-white/50">No spot wallet adjustments found.</td></tr>
              ) : (
                items.map((row) => (
                  <tr key={row.id} className="border-b border-surface-border/60 hover:bg-white/[.03]">
                    <td className="px-4 py-3 font-mono text-xs text-white/80">{row.id}</td>
                    <td className="px-4 py-3 font-mono text-xs text-white">{row.uid}</td>
                    <td className="px-4 py-3 font-bold">
                      <span className="inline-flex items-center gap-2">
                        <CoinAvatar asset={row.asset} className="h-6 w-6" />
                        {row.asset}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-bold uppercase px-2 py-1 rounded-md ${
                        row.direction === 'credit' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-300'
                      }`}>
                        {row.direction}
                      </span>
                    </td>
                    <td className={`px-4 py-3 text-right font-mono ${row.direction === 'credit' ? 'text-green-400' : 'text-red-300'}`}>
                      {Number(row.amount).toFixed(6)}
                    </td>
                    <td className="px-4 py-3 text-right font-mono text-xs text-white/75">
                      {Number(row.balance_before || 0).toFixed(6)} {'->'} {Number(row.balance_after || 0).toFixed(6)}
                    </td>
                    <td className="px-4 py-3 text-xs text-white/65">{row.admin_email || row.admin_aid || '—'}</td>
                    <td className="px-4 py-3 text-xs text-white/65 max-w-[220px] truncate" title={row.note}>{row.note || '—'}</td>
                    <td className="px-4 py-3 text-xs text-white/55 whitespace-nowrap">{row.created_at ? new Date(row.created_at).toLocaleString() : '—'}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="flex items-center justify-between mt-4 flex-wrap gap-3">
        <p className="text-white/50 text-sm">{total} rows · page {page} / {pages}</p>
        <div className="flex items-center gap-2">
          <select value={String(limit)} onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }}
            className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold">
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <button type="button" disabled={skip <= 0} onClick={() => setSkip((s) => Math.max(0, s - limit))}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40">Prev</button>
          <button type="button" disabled={skip + limit >= total} onClick={() => setSkip((s) => s + limit)}
            className="px-4 py-2 rounded-xl border border-surface-border text-sm font-bold disabled:opacity-40">Next</button>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={direction === 'debit' ? 'Reduce user spot balance' : 'Add user spot balance'}
        message={`Confirm ${direction === 'debit' ? 'debit' : 'credit'} of ${amount || 0} ${asset} for user ${uid || '(no uid)'}.`}
        confirmText={direction === 'debit' ? 'Reduce balance' : 'Add balance'}
        danger={direction === 'debit'}
        busy={busy}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={async () => { setConfirmOpen(false); await submitAdjustment(); }}
      />
    </>
  );
}

// ─── Futures panel ────────────────────────────────────────────────────────
function FuturesWalletPanel() {
  const [searchParams] = useSearchParams();

  // Adjustment form
  const [uid, setUid] = useState('');
  const [direction, setDirection] = useState('credit');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [okMsg, setOkMsg] = useState('');
  const [err, setErr] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);

  // Wallet list (per-user margin balances)
  const [wallets, setWallets] = useState([]);
  const [walletsTotal, setWalletsTotal] = useState(0);
  const [wLoading, setWLoading] = useState(false);
  const [uidFilter, setUidFilter] = useState(searchParams.get('uid') || '');
  const [skip, setSkip] = useState(0);
  const limit = 50;

  // User detail (snapshot + recent txns) when one row is selected
  const [selectedUid, setSelectedUid] = useState(searchParams.get('uid') || '');
  const [snapshot, setSnapshot] = useState(null);
  const [txns, setTxns] = useState([]);
  const [dLoading, setDLoading] = useState(false);

  const loadWallets = useCallback(async () => {
    setWLoading(true); setErr('');
    try {
      const params = { limit, skip };
      if (uidFilter.trim()) params.uid = uidFilter.trim();
      const r = await api.futures.listWallets(params);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not load futures wallets');
      setWallets(j.wallets || []);
      setWalletsTotal(j.total || 0);
    } catch (e) {
      setErr(e.message);
      setWallets([]); setWalletsTotal(0);
    } finally { setWLoading(false); }
  }, [uidFilter, skip]);

  useEffect(() => { loadWallets(); }, [loadWallets]);

  const loadDetail = useCallback(async (target) => {
    if (!target) { setSnapshot(null); setTxns([]); return; }
    setDLoading(true); setErr('');
    try {
      const [sr, tr] = await Promise.all([
        api.futures.walletSnapshot(target),
        api.futures.walletTxns(target, { limit: 50 }),
      ]);
      const sj = await sr.json().catch(() => ({}));
      const tj = await tr.json().catch(() => ({}));
      if (!sr.ok) throw new Error(sj.detail || 'snapshot failed');
      if (!tr.ok) throw new Error(tj.detail || 'txns failed');
      setSnapshot(sj);
      setTxns(tj.txns || []);
    } catch (e) {
      setErr(e.message); setSnapshot(null); setTxns([]);
    } finally { setDLoading(false); }
  }, []);

  useEffect(() => { loadDetail(selectedUid); }, [selectedUid, loadDetail]);

  const submitAdjustment = async () => {
    if (!uid.trim()) { setErr('User UID is required'); return; }
    const amt = Number(amount);
    if (!Number.isFinite(amt) || amt <= 0) { setErr('Amount must be greater than zero'); return; }
    if (!reason.trim()) { setErr('Reason is required for futures adjustments'); return; }
    setBusy(true); setErr(''); setOkMsg('');
    try {
      const r = await api.futures.adjustWallet({
        uid: uid.trim(),
        direction,
        amount: amt,
        reason: reason.trim(),
        note: note.trim() || undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Futures wallet adjustment failed');
      setOkMsg(`${direction === 'credit' ? 'Credited' : 'Debited'} ${amt} USDT for ${uid.trim()}`);
      setAmount(''); setNote('');
      await loadWallets();
      if (selectedUid === uid.trim()) await loadDetail(selectedUid);
    } catch (e) { setErr(e.message); }
    finally { setBusy(false); }
  };

  return (
    <>
      {err   && <p className="text-red-400 text-sm mb-4">{err}</p>}
      {okMsg && <p className="text-green-400 text-sm mb-4">{okMsg}</p>}

      <div className="admin-section p-4 sm:p-5 mb-6 min-w-0">
        <p className="text-base font-semibold text-white mb-1">Adjust futures wallet (USDT)</p>
        <p className="text-[12px] text-white/50 mb-4">
          Credits go to <strong>available</strong> margin. Debits only succeed if the user has enough free
          (un-locked) balance. <strong>Reason</strong> is mandatory and recorded on the ledger row alongside your admin email.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-6 gap-3">
          <div className="lg:col-span-2">
            <UserUidSuggestInput
              value={uid} onChange={setUid} placeholder="User UID"
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
            />
          </div>
          <select value={direction} onChange={(e) => setDirection(e.target.value)} className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white">
            <option value="credit">Add (credit)</option>
            <option value="debit">Reduce (debit)</option>
          </select>
          <input type="number" min="0" step="0.000001" value={amount}
            onChange={(e) => setAmount(e.target.value)} placeholder="Amount (USDT)"
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono" />
          <input value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Reason (required)"
            className="rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white" />
          <button type="button" disabled={busy} onClick={() => setConfirmOpen(true)}
            className={`rounded-xl px-4 py-2 text-sm font-bold border disabled:opacity-40 ${
              direction === 'debit'
                ? 'border-red-500/30 text-red-300 bg-red-500/10'
                : 'border-green-500/30 text-green-300 bg-green-500/10'
            }`}>
            {direction === 'debit' ? 'Reduce balance' : 'Add balance'}
          </button>
        </div>
        <div className="mt-3">
          <input value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Note (optional, internal)"
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white" />
        </div>
      </div>

      {/* Filter */}
      <div className="admin-filter-bar mb-4">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <UserUidSuggestInput value={uidFilter}
            onChange={(v) => { setSkip(0); setUidFilter(v); }} placeholder="Filter UID"
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono" />
          <button type="button"
            onClick={() => { setUidFilter(''); setSkip(0); setSelectedUid(''); }}
            className="rounded-xl border border-surface-border px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/[.04] justify-self-start">
            Clear
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-4">
        {/* Wallet rows */}
        <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden lg:col-span-2">
          <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
            <p className="text-xs font-extrabold text-white/55 uppercase tracking-wider">Margin balances</p>
            <p className="text-[11px] text-white/45">{walletsTotal} users · USDT only</p>
          </div>
          <div className="adm-table-x scrollbar-thin">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] text-white/50 uppercase border-b border-surface-border">
                  <th className="px-4 py-3">User</th>
                  <th className="px-4 py-3 text-right">Available</th>
                  <th className="px-4 py-3 text-right">Locked</th>
                  <th className="px-4 py-3 text-right">Total</th>
                  <th className="px-4 py-3 text-right pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {wLoading ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-white/45">Loading…</td></tr>
                ) : wallets.length === 0 ? (
                  <tr><td colSpan={5} className="px-4 py-12 text-center text-white/45">No futures wallets match this filter.</td></tr>
                ) : wallets.map((w) => {
                  const total = Number(w.available || 0) + Number(w.locked || 0);
                  return (
                    <tr key={`${w.uid}_${w.asset}`} className="border-b border-surface-border/60 hover:bg-white/[.03]">
                      <td className="px-4 py-3 font-mono text-xs text-white">{w.uid}</td>
                      <td className="px-4 py-3 text-right font-mono text-green-400">{Number(w.available || 0).toFixed(4)}</td>
                      <td className="px-4 py-3 text-right font-mono text-gold-light/80">{Number(w.locked || 0).toFixed(4)}</td>
                      <td className="px-4 py-3 text-right font-mono text-white">{total.toFixed(4)}</td>
                      <td className="px-4 py-3 text-right pr-4 space-x-1">
                        <button onClick={() => { setUid(w.uid); }}
                          className="px-2 py-1 rounded text-[11px] font-bold bg-gold-light/15 text-gold-light border border-gold-light/30">
                          Adjust
                        </button>
                        <button onClick={() => setSelectedUid(w.uid)}
                          className={`px-2 py-1 rounded text-[11px] font-bold border ${
                            selectedUid === w.uid
                              ? 'bg-gold-light/15 text-gold-light border-gold-light/30'
                              : 'bg-white/5 text-white/80 hover:bg-white/10 border-surface-border'
                          }`}>
                          Inspect
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {/* Pagination */}
          <div className="px-4 py-2 flex items-center justify-between text-[12px] text-white/55 border-t border-surface-border">
            <span>{walletsTotal} total · showing {wallets.length === 0 ? 0 : skip + 1}–{skip + wallets.length}</span>
            <div className="flex gap-2">
              <button disabled={skip <= 0} onClick={() => setSkip((s) => Math.max(0, s - limit))}
                className="px-3 py-1 rounded border border-surface-border text-xs font-bold disabled:opacity-30">Prev</button>
              <button disabled={skip + wallets.length >= walletsTotal} onClick={() => setSkip((s) => s + limit)}
                className="px-3 py-1 rounded border border-surface-border text-xs font-bold disabled:opacity-30">Next</button>
            </div>
          </div>
        </div>

        {/* Detail */}
        <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
          <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between">
            <p className="text-xs font-extrabold text-white/55 uppercase tracking-wider">User detail</p>
            <ArrowLeftRight size={12} className="text-white/40" />
          </div>
          <div className="p-4">
            {!selectedUid ? (
              <p className="text-[12px] text-white/45">Click <strong>Inspect</strong> on a row to load that user's snapshot and recent margin ledger.</p>
            ) : dLoading && !snapshot ? (
              <p className="text-[12px] text-white/45">Loading…</p>
            ) : !snapshot ? (
              <p className="text-[12px] text-white/45">No snapshot available.</p>
            ) : (
              <>
                <p className="text-[12px] font-mono text-white/80 mb-2">UID: {selectedUid}</p>
                <p className="text-[10px] uppercase tracking-wider text-white/45">Margin balance</p>
                <p className="text-2xl font-mono font-extrabold text-white mb-2">
                  {Number(snapshot.margin_balance || 0).toFixed(2)} <span className="text-sm font-bold text-white/55">USDT</span>
                </p>
                <div className="grid grid-cols-2 gap-2 text-[12px] mb-3">
                  <KV label="Available"      value={Number(snapshot.available || 0).toFixed(4)} />
                  <KV label="Locked"         value={Number(snapshot.locked || 0).toFixed(4)} />
                  <KV label="Free margin"    value={Number(snapshot.free_margin || 0).toFixed(4)} accent="text-gold-light" />
                  <KV label="Unrealized PnL"
                      value={`${Number(snapshot.unrealized_pnl || 0) >= 0 ? '+' : ''}${Number(snapshot.unrealized_pnl || 0).toFixed(4)}`}
                      accent={Number(snapshot.unrealized_pnl || 0) >= 0 ? 'text-green-300' : 'text-red-300'} />
                </div>
                <p className="text-[10px] uppercase tracking-wider text-white/45 mb-1">Recent ledger</p>
                <div className="max-h-72 overflow-y-auto divide-y divide-surface-border/60 text-[12px]">
                  {txns.length === 0 ? (
                    <div className="py-4 text-center text-white/40">No transactions.</div>
                  ) : txns.map((t) => (
                    <div key={t.id} className="py-1.5">
                      <div className="flex items-center justify-between">
                        <span className="capitalize text-white/75">{t.type}</span>
                        <span className={`font-mono ${t.direction === 'credit' ? 'text-green-300' : 'text-red-300'}`}>
                          {t.direction === 'credit' ? '+' : '−'}{Number(t.amount || 0).toFixed(4)}
                        </span>
                      </div>
                      <div className="text-[10px] text-white/40">
                        {(t.created_at || '').slice(0, 19).replace('T', ' ')}
                        {t.ref_type ? ` · ${t.ref_type}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        open={confirmOpen}
        title={direction === 'debit' ? 'Reduce user futures balance' : 'Add user futures balance'}
        message={`Confirm ${direction === 'debit' ? 'debit' : 'credit'} of ${amount || 0} USDT for user ${uid || '(no uid)'} — reason: ${reason || '(none)'}.`}
        confirmText={direction === 'debit' ? 'Reduce balance' : 'Add balance'}
        danger={direction === 'debit'}
        busy={busy}
        onClose={() => { if (!busy) setConfirmOpen(false); }}
        onConfirm={async () => { setConfirmOpen(false); await submitAdjustment(); }}
      />
    </>
  );
}

function KV({ label, value, accent = 'text-white' }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-white/55">{label}</span>
      <span className={`font-mono ${accent}`}>{value}</span>
    </div>
  );
}
