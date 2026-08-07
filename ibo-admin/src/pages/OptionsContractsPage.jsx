import { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshCw, AlertTriangle, Plus, FlaskConical, Gavel, X, Search } from 'lucide-react';
import { api } from '@/lib/api';
import { formatAdminApiDetail } from '@/lib/adminApiDetail';

function formatContractExpiry(iso) {
  if (!iso) return '—';
  const s = String(iso).trim();
  const t = Date.parse(s.includes('T') ? s : `${s}Z`);
  if (!Number.isFinite(t)) return s.length > 28 ? `${s.slice(0, 26)}…` : s;
  const d = new Date(t);
  return `${d.toISOString().slice(0, 10)} · ${d.toISOString().slice(11, 16)} UTC`;
}

function fmtStrike(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '—';
  return x.toLocaleString(undefined, { maximumFractionDigits: 8 });
}

function contractStatusMeta(row) {
  if (row.settled_at || String(row.status).toLowerCase() === 'settled') {
    return { label: 'Settled', className: 'bg-zinc-600/25 text-zinc-200 border-zinc-500/30' };
  }
  const s = String(row.status || '—').toLowerCase();
  if (s === 'listed') return { label: 'Listed', className: 'bg-emerald-500/15 text-emerald-200 border-emerald-400/30' };
  if (s === 'draft') return { label: 'Draft', className: 'bg-white/10 text-white/65 border-white/15' };
  if (s === 'expired') return { label: 'Expired', className: 'bg-gold/15 text-gold-light border-gold/30' };
  if (s === 'settling') return { label: 'Settling', className: 'bg-sky-500/15 text-sky-200 border-sky-400/30' };
  if (s === 'halted') return { label: 'Halted', className: 'bg-rose-500/15 text-rose-200 border-rose-400/30' };
  return { label: s || '—', className: 'bg-white/10 text-white/70 border-white/10' };
}

function PreviewTable({ data }) {
  if (!data || typeof data !== 'object') return null;
  const preferred = [
    ['settlement_index', data.settlement_index],
    ['index_source', data.index_source],
    ['intrinsic / contract (USDT)', data.intrinsic_per_contract_usdt],
    ['open_positions', data.open_positions],
    ['open_orders', data.open_orders],
    ['total_payout (USDT)', data.total_payout_usdt],
  ].filter(([, v]) => v !== undefined && v !== null);
  const skip = new Set([
    'settlement_index',
    'index_source',
    'intrinsic_per_contract_usdt',
    'open_positions',
    'open_orders',
    'total_payout_usdt',
  ]);
  const rest = Object.entries(data).filter(([k]) => !skip.has(k));
  const rows = [...preferred, ...rest.map(([k, v]) => [k, typeof v === 'object' ? JSON.stringify(v) : String(v)])];
  return (
    <div className="rounded-lg border border-white/10 overflow-hidden mt-2 bg-surface-dark">
      <table className="w-full text-xs table-fixed">
        <tbody>
          {rows.map(([k, v]) => (
            <tr key={k} className="border-b border-white/[0.06] last:border-0">
              <td className="px-3 py-2 w-[44%] text-white/50 font-mono text-[10px] uppercase tracking-wide align-top break-words">
                {k}
              </td>
              <td className="px-3 py-2 text-white/90 font-mono tabular-nums align-top break-words [overflow-wrap:anywhere]">
                {String(v)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function OptionsContractsPage() {
  const [rows, setRows] = useState([]);
  const [underlyings, setUnderlyings] = useState([]);
  const [filterUnderlying, setFilterUnderlying] = useState('');
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [underlyingSymbol, setUnderlyingSymbol] = useState('');
  const [expiry, setExpiry] = useState('');
  const [strike, setStrike] = useState('');
  const [optionType, setOptionType] = useState('call');
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewContractId, setPreviewContractId] = useState(null);
  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [successNote, setSuccessNote] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = { listed_only: false };
      if (filterUnderlying.trim()) params.underlying_symbol = filterUnderlying.trim().toUpperCase();
      const [cRes, uRes] = await Promise.all([api.options.listContracts(params), api.options.listUnderlyings({ listed_only: false })]);
      const c = await cRes.json().catch(() => ({}));
      const u = await uRes.json().catch(() => ({}));
      if (!cRes.ok) throw new Error(formatAdminApiDetail(c) || `Contracts failed (${cRes.status})`);
      if (!uRes.ok) throw new Error(formatAdminApiDetail(u) || `Underlyings failed (${uRes.status})`);
      setRows(Array.isArray(c.contracts) ? c.contracts : []);
      const us = Array.isArray(u.underlyings) ? u.underlyings : [];
      setUnderlyings(us);
      setUnderlyingSymbol((prev) => {
        if (prev && us.some((x) => x.symbol === prev)) return prev;
        return us[0]?.symbol || '';
      });
    } catch (e) {
      setError(e.message);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [filterUnderlying]);

  useEffect(() => {
    load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const blob = [r.id, r.underlying_symbol, r.expiry, r.strike, r.option_type, r.status, r.settled_at]
        .map((x) => String(x ?? '').toLowerCase())
        .join(' ');
      return blob.includes(q);
    });
  }, [rows, search]);

  const create = async () => {
    setBusy(true);
    setError(null);
    try {
      const exp = expiry.trim();
      if (!exp) throw new Error('Expiry required (ISO8601 UTC, e.g. 2026-12-20T16:00:00Z)');
      const k = parseFloat(strike);
      if (!Number.isFinite(k) || k <= 0) throw new Error('Invalid strike');
      const res = await api.options.createContract({
        underlying_symbol: underlyingSymbol.trim().toUpperCase(),
        expiry: exp,
        strike: k,
        option_type: optionType,
        listed: true,
        trading_enabled: true,
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatAdminApiDetail(j) || 'Create failed');
      setRows((r) => [j, ...r]);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (row, field) => {
    setBusy(true);
    try {
      const res = await api.options.patchContract(row.id, { [field]: !row[field] });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatAdminApiDetail(j) || 'Update failed');
      setRows((rs) => rs.map((x) => (x.id === row.id ? j : x)));
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const settlePreview = async (row) => {
    setBusy(true);
    setError(null);
    setPreviewOpen(true);
    setPreviewContractId(row.id);
    setPreviewData(null);
    setPreviewLoading(true);
    try {
      const res = await api.options.settleContract(row.id, { dry_run: true });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatAdminApiDetail(j) || 'Preview failed');
      setPreviewData(j);
    } catch (e) {
      setError(e.message);
      setPreviewOpen(false);
    } finally {
      setBusy(false);
      setPreviewLoading(false);
    }
  };

  const settleExecute = async (row) => {
    if (
      !window.confirm(
        `Settle ${row.id}? Cancels open orders, pays intrinsic in USDT, marks settled.`,
      )
    )
      return;
    setBusy(true);
    setError(null);
    setSuccessNote(null);
    try {
      const res = await api.options.settleContract(row.id, { dry_run: false, force: true });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(formatAdminApiDetail(j) || 'Settle failed');
      await load();
      setSuccessNote(`${row.id} settled · legs ${(j.settled_legs || []).length}`);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const closePreview = () => {
    setPreviewOpen(false);
    setPreviewContractId(null);
    setPreviewData(null);
    setPreviewLoading(false);
  };

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded-xl border border-rose-400/30 bg-rose-500/10 text-rose-200 px-4 py-3 text-sm flex items-start gap-2">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <span className="break-words">{error}</span>
        </div>
      )}
      {successNote && (
        <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/10 text-emerald-200 px-4 py-3 text-sm flex items-center justify-between gap-2">
          <span className="font-mono text-xs break-all">{successNote}</span>
          <button type="button" onClick={() => setSuccessNote(null)} className="text-white/50 hover:text-white text-xs shrink-0">
            Dismiss
          </button>
        </div>
      )}

      <div className="rounded-xl border border-white/[0.08] bg-surface-dark p-4 space-y-4">
        <h2 className="text-sm font-bold text-white">Create contract</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[130px]">
            <label className="block text-[11px] text-white/50 font-bold uppercase">Underlying</label>
            <select
              value={underlyingSymbol}
              onChange={(e) => setUnderlyingSymbol(e.target.value)}
              className="mt-1 w-full rounded-lg bg-surface-card border border-white/15 px-3 py-2 text-sm text-white font-mono"
            >
              {underlyings.map((u) => (
                <option key={u.id} value={u.symbol}>
                  {u.symbol}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[88px]">
            <label className="block text-[11px] text-white/50 font-bold uppercase">Type</label>
            <select
              value={optionType}
              onChange={(e) => setOptionType(e.target.value)}
              className="mt-1 w-full rounded-lg bg-surface-card border border-white/15 px-3 py-2 text-sm text-white"
            >
              <option value="call">Call</option>
              <option value="put">Put</option>
            </select>
          </div>
          <div className="min-w-[220px] flex-1">
            <label className="block text-[11px] text-white/50 font-bold uppercase">Expiry UTC</label>
            <input
              value={expiry}
              onChange={(e) => setExpiry(e.target.value)}
              placeholder="2026-12-20T16:00:00Z"
              className="mt-1 w-full rounded-lg bg-surface-card border border-white/15 px-3 py-2 text-sm text-white font-mono"
            />
          </div>
          <div className="min-w-[100px]">
            <label className="block text-[11px] text-white/50 font-bold uppercase">Strike</label>
            <input
              value={strike}
              onChange={(e) => setStrike(e.target.value)}
              placeholder="70000"
              className="mt-1 w-full rounded-lg bg-surface-card border border-white/15 px-3 py-2 text-sm text-white font-mono tabular-nums"
            />
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={create}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/20 border border-emerald-400/40 px-4 py-2 text-sm font-bold text-emerald-200"
          >
            <Plus size={16} /> Add
          </button>
        </div>
      </div>

      <div className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-3 rounded-xl border border-white/[0.08] bg-surface-dark px-4 py-3">
        <div className="flex items-center gap-2 min-w-[160px]">
          <label className="text-[11px] uppercase font-bold text-white/50 whitespace-nowrap">Filter</label>
          <select
            value={filterUnderlying}
            onChange={(e) => setFilterUnderlying(e.target.value)}
            className="flex-1 rounded-lg bg-surface-card border border-white/15 px-2 py-2 text-sm text-white font-mono"
          >
            <option value="">All underlyings</option>
            {underlyings.map((u) => (
              <option key={u.id} value={u.symbol}>
                {u.symbol}
              </option>
            ))}
          </select>
        </div>
        <div className="flex items-center gap-2 flex-1 min-w-[200px] max-w-md">
          <Search size={16} className="text-white/35 shrink-0" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search id, symbol, expiry, strike…"
            className="flex-1 rounded-lg bg-surface-card border border-white/15 px-3 py-2 text-sm text-white placeholder:text-white/30"
          />
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-xs font-bold text-white/70 hover:bg-white/5 sm:ml-auto"
          aria-label="Refresh"
        >
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>

      <div className="rounded-xl border border-white/[0.08] bg-surface-dark overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[1100px]">
            <thead className="text-left text-[11px] uppercase text-white/50 font-bold border-b border-white/10 bg-surface-dark">
              <tr>
                <th className="px-3 py-3 min-w-[200px]">Contract</th>
                <th className="px-3 py-3 whitespace-nowrap">Underlying</th>
                <th className="px-3 py-3 min-w-[140px]">Expiry</th>
                <th className="px-3 py-3 text-right whitespace-nowrap">Strike</th>
                <th className="px-3 py-3 whitespace-nowrap">Type</th>
                <th className="px-3 py-3 whitespace-nowrap">Status</th>
                <th className="px-3 py-3 text-center whitespace-nowrap">Listed</th>
                <th className="px-3 py-3 text-center whitespace-nowrap">Trade</th>
                <th className="px-3 py-3 min-w-[160px]">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/[0.06]">
              {loading && (
                <tr>
                  <td colSpan={9} className="px-3 py-12 text-center text-white/45">
                    Loading contracts…
                  </td>
                </tr>
              )}
              {!loading &&
                filteredRows.map((r) => {
                  const meta = contractStatusMeta(r);
                  const settled = !!(r.settled_at || String(r.status).toLowerCase() === 'settled');
                  return (
                    <tr key={r.id} className="hover:bg-white/[0.03]">
                      <td className="px-3 py-2.5 align-top">
                        <span
                          className="font-mono text-xs text-gold-light/95 block truncate max-w-[280px]"
                          title={r.id}
                        >
                          {r.id}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-white/90 whitespace-nowrap">{r.underlying_symbol || '—'}</td>
                      <td className="px-3 py-2.5 text-white/85 text-xs font-mono leading-snug">{formatContractExpiry(r.expiry)}</td>
                      <td className="px-3 py-2.5 text-right font-mono tabular-nums text-white">{fmtStrike(r.strike)}</td>
                      <td className="px-3 py-2.5 text-white/85 text-xs uppercase font-semibold">{r.option_type || '—'}</td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-bold ${meta.className}`}
                        >
                          {meta.label}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-gold"
                          checked={!!r.listed}
                          disabled={busy || settled}
                          onChange={() => toggle(r, 'listed')}
                          aria-label={`Listed ${r.id}`}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-center">
                        <input
                          type="checkbox"
                          className="w-4 h-4 accent-gold"
                          checked={!!r.trading_enabled}
                          disabled={busy || settled}
                          onChange={() => toggle(r, 'trading_enabled')}
                          aria-label={`Trading ${r.id}`}
                        />
                      </td>
                      <td className="px-3 py-2.5 align-top">
                        {settled ? (
                          <span className="text-white/35 text-xs">—</span>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => settlePreview(r)}
                              className="inline-flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/80 hover:bg-white/5"
                            >
                              <FlaskConical size={12} /> Preview
                            </button>
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => settleExecute(r)}
                              className="inline-flex items-center gap-1 rounded-md border border-gold/35 px-2 py-1 text-[11px] text-gold-light/90 hover:bg-gold/10"
                            >
                              <Gavel size={12} /> Settle
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
        </div>
        {!loading && !filteredRows.length && (
          <p className="p-8 text-center text-white/45 text-sm">
            {rows.length ? 'No contracts match your search.' : 'No contracts in the database for this filter.'}
          </p>
        )}
        {!loading && rows.length > 0 && (
          <div className="px-4 py-2 border-t border-white/[0.06] text-[11px] text-white/40">
            Showing {filteredRows.length} of {rows.length} loaded
            {filterUnderlying ? ` · ${filterUnderlying}` : ''}
          </div>
        )}
      </div>

      {previewOpen && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4"
          onClick={closePreview}
          role="presentation"
        >
          <div
            className="w-full max-w-lg rounded-xl border border-white/15 bg-[#12141a] shadow-xl p-4 text-white max-h-[90dvh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-labelledby="settle-preview-title"
          >
            <div className="flex items-start justify-between gap-2 mb-2">
              <h3 id="settle-preview-title" className="text-sm font-bold text-white">
                Settlement preview
                {previewContractId != null && (
                  <span className="block font-mono text-xs text-gold-light/90 mt-1 break-all">{previewContractId}</span>
                )}
              </h3>
              <button type="button" onClick={closePreview} className="p-1 text-white/50 hover:text-white rounded-lg shrink-0">
                <X size={18} />
              </button>
            </div>
            {previewLoading && <p className="text-sm text-white/50 py-4">Loading…</p>}
            {!previewLoading && previewData && <PreviewTable data={previewData} />}
            <button
              type="button"
              onClick={closePreview}
              className="mt-4 w-full rounded-lg border border-white/15 py-2 text-sm font-bold text-white/85 hover:bg-white/5"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
