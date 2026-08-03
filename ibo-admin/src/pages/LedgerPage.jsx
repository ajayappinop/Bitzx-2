import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ScrollText, RefreshCw, Download } from 'lucide-react';
import { api } from '@/lib/api';
import UserUidSuggestInput from '@/components/UserUidSuggestInput';
import CoinAvatar from '@/components/CoinAvatar';
import InrLedgerRefCell from '@/components/InrLedgerRefCell';
import {
  formatWalletTxnRef,
  formatLedgerAmount,
  ledgerTypeLabel,
  ledgerStatusLabel,
  mergeLedgerWithInrDeposits,
  isInrWithdrawalRow,
} from '@/lib/inrDisplay';

const TYPE_OPTIONS = [
  '', 'deposit', 'withdraw', 'trade', 'fee', 'adjustment',
  'lock', 'unlock', 'seed', 'opening_balance',
];

export default function LedgerPage() {
  const [searchParams] = useSearchParams();
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(50);
  const [uidFilter, setUidFilter] = useState(searchParams.get('uid') || '');
  const [assetFilter, setAssetFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [refIdFilter, setRefIdFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (uidFilter.trim()) params.uid = uidFilter.trim();
      if (assetFilter.trim()) params.asset = assetFilter.trim();
      if (typeFilter) params.type = typeFilter;
      if (refIdFilter.trim()) params.ref_id = refIdFilter.trim();
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const r = await api.walletTxns(params);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not load ledger');
      let rows = j.items || [];
      const uid = uidFilter.trim();
      if (uid) {
        const [inrDepRes, inrWdRes] = await Promise.all([
          api.inrDeposits({ uid, skip: '0', limit: '200' }),
          api.inrWithdrawals({ uid, skip: '0', limit: '200' }),
        ]);
        const inrDepJ = await inrDepRes.json().catch(() => ({}));
        const inrWdJ = await inrWdRes.json().catch(() => ({}));
        if (inrDepRes.ok || inrWdRes.ok) {
          rows = mergeLedgerWithInrDeposits(
            rows,
            inrDepRes.ok ? inrDepJ.items || [] : [],
            inrWdRes.ok ? inrWdJ.items || [] : [],
          );
        }
      }
      setItems(rows);
      setTotal(uid ? rows.length : (j.total ?? 0));
    } catch (e) {
      setErr(e.message);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [skip, limit, uidFilter, assetFilter, typeFilter, refIdFilter, dateFrom, dateTo]);

  useEffect(() => {
    load();
  }, [load]);

  const pages = useMemo(() => Math.max(1, Math.ceil(total / limit)), [total, limit]);
  const page = useMemo(() => Math.floor(skip / limit) + 1, [skip, limit]);

  async function downloadCsv() {
    setErr('');
    try {
      const params = { max_rows: '10000' };
      if (uidFilter.trim()) params.uid = uidFilter.trim();
      if (assetFilter.trim()) params.asset = assetFilter.trim();
      if (typeFilter) params.type = typeFilter;
      if (refIdFilter.trim()) params.ref_id = refIdFilter.trim();
      if (dateFrom) params.date_from = dateFrom;
      if (dateTo) params.date_to = dateTo;
      const r = await api.walletTxnsExport(params);
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.detail || `Export failed (${r.status})`);
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `wallet_txns_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e.message);
    }
  }

  return (
    <div className="admin-page space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="admin-title flex items-center gap-2">
            <ScrollText className="text-gold-light" size={26} /> Ledger
          </h1>
          <p className="admin-page-lead mt-2 max-w-2xl">
            Wallet credits and debits: on-chain deposits, INR fiat deposits (IBO credit), trades, locks, fees, and adjustments. Read-only; export to CSV for reporting.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-white/10 text-white/80 hover:bg-white/5 disabled:opacity-40"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          <button
            type="button"
            onClick={downloadCsv}
            className="inline-flex items-center gap-2 px-3 py-2 rounded-xl border border-gold/35 text-gold-light hover:bg-gold/10"
          >
            <Download size={14} /> Export CSV
          </button>
        </div>
      </div>

      {err ? (
        <div className="p-3 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-300 text-sm">{err}</div>
      ) : null}

      <div className="admin-filter-bar space-y-3">
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label className="text-[11px] text-white/50 uppercase font-bold block mb-1">User UID</label>
            <UserUidSuggestInput value={uidFilter} onChange={(v) => { setUidFilter(v); setSkip(0); }} />
          </div>
          <label className="text-xs text-white/70">
            <span className="block mb-1">Asset</span>
            <input
              value={assetFilter}
              onChange={(e) => { setAssetFilter(e.target.value); setSkip(0); }}
              placeholder="e.g. USDT"
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono uppercase"
            />
          </label>
          <label className="text-xs text-white/70">
            <span className="block mb-1">Type</span>
            <select
              value={typeFilter}
              onChange={(e) => { setTypeFilter(e.target.value); setSkip(0); }}
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            >
              {TYPE_OPTIONS.map((t) => (
                <option key={t || 'all'} value={t}>{t || 'All types'}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-white/70">
            <span className="block mb-1">Ref id</span>
            <input
              value={refIdFilter}
              onChange={(e) => { setRefIdFilter(e.target.value); setSkip(0); }}
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
            />
          </label>
          <label className="text-xs text-white/70">
            <span className="block mb-1">From (ISO)</span>
            <input
              value={dateFrom}
              onChange={(e) => { setDateFrom(e.target.value); setSkip(0); }}
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/70">
            <span className="block mb-1">To (ISO)</span>
            <input
              value={dateTo}
              onChange={(e) => { setDateTo(e.target.value); setSkip(0); }}
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            />
          </label>
          <label className="text-xs text-white/70">
            <span className="block mb-1">Page size</span>
            <select
              value={limit}
              onChange={(e) => { setLimit(Number(e.target.value)); setSkip(0); }}
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            >
              {[25, 50, 100, 200].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
          </label>
        </div>
        <div>
          <button
            type="button"
            onClick={() => {
              setSkip(0);
              setUidFilter('');
              setAssetFilter('');
              setTypeFilter('');
              setRefIdFilter('');
              setDateFrom('');
              setDateTo('');
            }}
            className="rounded-xl border border-surface-border px-3 py-2 text-xs font-bold text-white/80 hover:bg-white/[.04]"
          >
            Clear filters
          </button>
        </div>
      </div>

      <div className="rounded-2xl border border-surface-border bg-surface-card adm-table-x scrollbar-thin">
        <table className="w-full text-sm min-w-[960px]">
          <thead className="text-left text-[11px] text-white/50 uppercase border-b border-surface-border bg-white/5">
            <tr>
              <th className="px-3 py-2">When</th>
              <th className="px-3 py-2">UID</th>
              <th className="px-3 py-2">Asset</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2 text-right">Amt</th>
              <th className="px-3 py-2">UTR / reference</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-white/45">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-12 text-center text-white/45">No rows.</td></tr>
            ) : (
              items.map((row) => {
                const isInr =
                  row.ref_type === 'inr_deposit'
                  || row.ref_type === 'inr_withdrawal'
                  || row._ledgerKind?.startsWith('inr_');
                return (
                <tr key={row.id} className="border-b border-white/5">
                  <td className="px-3 py-2 text-[11px] text-white/55 whitespace-nowrap">
                    {row.created_at ? new Date(row.created_at).toLocaleString() : '—'}
                  </td>
                  <td className="px-3 py-2 font-mono text-[11px] text-white/70">{row.uid}</td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1.5 font-bold">
                      <CoinAvatar asset={row.asset} className="h-5 w-5" />
                      {row.asset}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-xs font-bold text-gold-light/90">{ledgerTypeLabel(row)}</td>
                  <td className="px-3 py-2 text-right font-mono text-xs">
                    {isInr && (row._ledgerKind?.startsWith('inr_') || isInrWithdrawalRow(row))
                      ? formatLedgerAmount(row)
                      : `${row.direction === 'debit' ? '−' : '+'}${Number(row.amount || 0).toFixed(8)}`}
                  </td>
                  <td className="px-3 py-2 min-w-0">
                    {isInr ? (
                      <InrLedgerRefCell row={row} />
                    ) : (
                      <span className="font-mono text-[11px] text-white/55 truncate block">{formatWalletTxnRef(row)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs capitalize">{ledgerStatusLabel(row)}</td>
                </tr>
              );
              })
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-sm text-white/60">
        <span>
          {total ? `Showing ${skip + 1}–${Math.min(skip + limit, total)} of ${total}` : 'No results'}
        </span>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={skip <= 0}
            onClick={() => setSkip((s) => Math.max(0, s - limit))}
            className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-30"
          >
            Prev
          </button>
          <span className="self-center text-white/45">Page {page} / {pages}</span>
          <button
            type="button"
            disabled={skip + limit >= total}
            onClick={() => setSkip((s) => s + limit)}
            className="px-3 py-1.5 rounded-lg border border-white/10 disabled:opacity-30"
          >
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
