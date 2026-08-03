import { useCallback, useEffect, useMemo, useState } from 'react';
import { Landmark, Download, RefreshCw } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminPageHeader, GradientStatCard, FilterBar } from '@/components/AdminPrimitives';

function fmtUsd(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 4 })}`;
}

function fmtNum(v, d = 8) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return n.toLocaleString(undefined, { maximumFractionDigits: d });
}

export default function FinancePage() {
  const [days, setDays] = useState('30');
  const [symbol, setSymbol] = useState('');
  const [exportFormat, setExportFormat] = useState('csv');
  const [data, setData] = useState(null);
  const [revenue, setRevenue] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyExport, setBusyExport] = useState(false);
  const [exportStatus, setExportStatus] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await api.financeOverview({ days, symbol: symbol.trim().toUpperCase() || undefined });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body?.detail || 'Failed to load finance overview');
      const rr = await api.financeRevenueReport({ days, symbol: symbol.trim().toUpperCase() || undefined });
      const rrb = await rr.json().catch(() => ({}));
      if (!rr.ok) throw new Error(rrb?.detail || 'Failed to load revenue report');
      setData(body);
      setRevenue(rrb);
    } catch (e) {
      setErr(e?.message || 'Failed to load finance overview');
      setData(null);
      setRevenue(null);
    } finally {
      setLoading(false);
    }
  }, [days, symbol]);

  useEffect(() => { load(); }, [load]);

  const lvr = data?.liabilities_vs_reserves || {};
  const totals = lvr?.totals || {};
  const rows = useMemo(() => (lvr?.rows || []).slice().sort((a, b) => Math.abs(Number(b.liability_usdt || 0)) - Math.abs(Number(a.liability_usdt || 0))), [lvr]);
  const revRows = revenue?.rows || [];
  const revTotals = revenue?.totals || {};

  async function exportCsv() {
    setBusyExport(true);
    setErr('');
    setExportStatus('Starting export job…');
    try {
      const createRes = await api.createFinanceExportJob({
        days: Number(days),
        symbol: symbol.trim().toUpperCase() || undefined,
        format: exportFormat,
      });
      const createBody = await createRes.json().catch(() => ({}));
      if (!createRes.ok) throw new Error(createBody?.detail || 'Could not create export job');
      const jobId = createBody?.job_id;
      if (!jobId) throw new Error('Invalid export job response');

      let finalJob = null;
      for (let i = 0; i < 60; i += 1) {
        const jr = await api.financeExportJob(jobId);
        const jb = await jr.json().catch(() => ({}));
        if (!jr.ok) throw new Error(jb?.detail || 'Could not read export job status');
        finalJob = jb;
        setExportStatus(`Export status: ${jb.status}${jb.rows ? ` (${jb.rows} rows)` : ''}`);
        if (jb.status === 'completed' || jb.status === 'failed') break;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
      if (!finalJob) throw new Error('Export job polling failed');
      if (finalJob.status !== 'completed') {
        throw new Error(finalJob.error || `Export job did not complete (status: ${finalJob.status})`);
      }

      const res = await api.financeExportJobDownload(jobId);
      const text = await res.text();
      if (!res.ok) throw new Error(text || 'Export download failed');
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = String(finalJob.filename || `finance_overview_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`);
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setExportStatus(`Export complete (${finalJob.rows || 0} rows, ${String(finalJob.file_format || exportFormat).toUpperCase()}).`);
    } catch (e) {
      setErr(e?.message || 'Export failed');
      setExportStatus('');
    } finally {
      setBusyExport(false);
    }
  }

  async function exportRevenueCsv() {
    setErr('');
    try {
      const res = await api.financeRevenueReportExport({ days, symbol: symbol.trim().toUpperCase() || undefined });
      const text = await res.text();
      if (!res.ok) throw new Error(text || 'Revenue export failed');
      const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `finance_revenue_report_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setErr(e?.message || 'Revenue export failed');
    }
  }

  return (
    <div className="admin-page">
      <AdminPageHeader
        icon={Landmark}
        title="Finance & Reports"
        subtitle="Check trading volume, fees, what customers are owed versus what you hold, and download spreadsheets."
        actions={(
          <>
            <button type="button" onClick={exportCsv} disabled={busyExport} className="inline-flex items-center gap-2 rounded-xl border border-cyan-400/35 bg-cyan-500/15 px-3 py-2 text-cyan-100 text-sm font-bold disabled:opacity-40">
              <Download size={14} /> {busyExport ? 'Exporting…' : 'Export Sheet'}
            </button>
            <button type="button" onClick={load} disabled={loading} className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-3 py-2 text-white/85 text-sm font-bold disabled:opacity-40">
              <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
            </button>
          </>
        )}
      />

      <FilterBar>
        <div className="grid sm:grid-cols-4 gap-3">
        <select value={days} onChange={(e) => setDays(e.target.value)} className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white">
          {['7', '30', '90', '180', '365'].map((d) => <option key={d} value={d}>Last {d} days</option>)}
        </select>
        <select value={exportFormat} onChange={(e) => setExportFormat(e.target.value)} className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white">
          <option value="csv">CSV export</option>
          <option value="xlsx">XLSX export</option>
        </select>
        <input value={symbol} onChange={(e) => setSymbol(e.target.value)} placeholder="Symbol filter (optional, e.g. BTCUSDT)" className="sm:col-span-2 rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-sm text-white font-mono uppercase placeholder:text-white/35" />
        </div>
      </FilterBar>

      {err ? <p className="text-red-400 text-sm">{err}</p> : null}
      {exportStatus ? <p className="text-white/65 text-sm">{exportStatus}</p> : null}

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <GradientStatCard label="Trades (window)" value={fmtNum(data?.period?.trades || 0, 0)} tone="violet" />
        <GradientStatCard label="Volume USDT (window)" value={fmtUsd(data?.period?.volume_usdt || 0)} tone="cyan" />
        <GradientStatCard label="Fees USDT estimate" value={fmtUsd(data?.period?.fees_usdt_estimate || 0)} tone="emerald" />
        <GradientStatCard label="Reserve coverage" value={totals.coverage_pct == null ? '—' : `${Number(totals.coverage_pct).toFixed(2)}%`} tone="amber" />
      </div>

      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border text-sm font-bold text-white/85 uppercase">Liabilities vs reserves by asset</div>
        <div className="adm-table-x">
          <table className="w-full text-sm min-w-[1100px]">
            <thead>
              <tr className="text-left text-[11px] text-white/45 border-b border-surface-border">
                <th className="px-4 py-3">Asset</th><th className="px-4 py-3 text-right">Mark</th><th className="px-4 py-3 text-right">Liability qty</th><th className="px-4 py-3 text-right">Reserve qty</th><th className="px-4 py-3 text-right">Gap qty</th><th className="px-4 py-3 text-right">Liability USDT</th><th className="px-4 py-3 text-right">Reserve USDT</th><th className="px-4 py-3 text-right">Gap USDT</th><th className="px-4 py-3 text-right">Coverage</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-14 text-center text-white/50">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-14 text-center text-white/50">No rows.</td></tr>
              ) : rows.map((r) => (
                <tr key={r.asset} className="border-b border-surface-border/50">
                  <td className="px-4 py-3 font-mono">{r.asset}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtNum(r.mark_usdt, 8)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtNum(r.liability_qty, 8)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtNum(r.reserve_qty, 8)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${Number(r.gap_qty || 0) < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{fmtNum(r.gap_qty, 8)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtUsd(r.liability_usdt)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtUsd(r.reserve_usdt)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${Number(r.gap_usdt || 0) < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{fmtUsd(r.gap_usdt)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${Number(r.coverage_pct || 0) < 100 ? 'text-red-300' : 'text-emerald-300'}`}>{r.coverage_pct == null ? '—' : `${Number(r.coverage_pct).toFixed(2)}%`}</td>
                </tr>
              ))}
              <tr className="bg-white/[0.02]">
                <td className="px-4 py-3 font-bold text-white/85">TOTAL</td>
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3" />
                <td className="px-4 py-3 text-right font-mono font-bold">{fmtUsd(totals.liabilities_usdt || 0)}</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{fmtUsd(totals.reserves_usdt || 0)}</td>
                <td className={`px-4 py-3 text-right font-mono font-bold ${Number(totals.gap_usdt || 0) < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{fmtUsd(totals.gap_usdt || 0)}</td>
                <td className={`px-4 py-3 text-right font-mono font-bold ${Number(totals.coverage_pct || 0) < 100 ? 'text-red-300' : 'text-emerald-300'}`}>{totals.coverage_pct == null ? '—' : `${Number(totals.coverage_pct).toFixed(2)}%`}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
        <div className="px-4 py-3 border-b border-surface-border flex items-center justify-between gap-3">
          <p className="text-xs font-bold text-white/55 uppercase">Daily revenue report</p>
          <button type="button" onClick={exportRevenueCsv} className="inline-flex items-center gap-2 rounded-xl border border-surface-border px-3 py-1.5 text-white/80 text-xs font-bold">
            <Download size={12} /> Export revenue CSV
          </button>
        </div>
        <div className="adm-table-x">
          <table className="w-full text-sm min-w-[1000px]">
            <thead>
              <tr className="text-left text-[11px] text-white/45 border-b border-surface-border">
                <th className="px-4 py-3">Date</th><th className="px-4 py-3 text-right">Trades</th><th className="px-4 py-3 text-right">Volume USDT</th><th className="px-4 py-3 text-right">Fees est.</th><th className="px-4 py-3 text-right">Spread PnL</th><th className="px-4 py-3 text-right">Total revenue est.</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-14 text-center text-white/50">Loading…</td></tr>
              ) : revRows.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-14 text-center text-white/50">No revenue rows.</td></tr>
              ) : revRows.map((r) => (
                <tr key={r.date} className="border-b border-surface-border/50">
                  <td className="px-4 py-3 font-mono">{r.date}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtNum(r.trades, 0)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtUsd(r.volume_usdt)}</td>
                  <td className="px-4 py-3 text-right font-mono">{fmtUsd(r.fees_usdt_estimate)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${Number(r.spread_pnl_usdt || 0) < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{fmtUsd(r.spread_pnl_usdt)}</td>
                  <td className={`px-4 py-3 text-right font-mono font-bold ${Number(r.total_revenue_usdt_estimate || 0) < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{fmtUsd(r.total_revenue_usdt_estimate)}</td>
                </tr>
              ))}
              <tr className="bg-white/[0.02]">
                <td className="px-4 py-3 font-bold text-white/85">TOTAL</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{fmtNum(revTotals.trades || 0, 0)}</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{fmtUsd(revTotals.volume_usdt || 0)}</td>
                <td className="px-4 py-3 text-right font-mono font-bold">{fmtUsd(revTotals.fees_usdt_estimate || 0)}</td>
                <td className={`px-4 py-3 text-right font-mono font-bold ${Number(revTotals.spread_pnl_usdt || 0) < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{fmtUsd(revTotals.spread_pnl_usdt || 0)}</td>
                <td className={`px-4 py-3 text-right font-mono font-bold ${Number(revTotals.total_revenue_usdt_estimate || 0) < 0 ? 'text-red-300' : 'text-emerald-300'}`}>{fmtUsd(revTotals.total_revenue_usdt_estimate || 0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

