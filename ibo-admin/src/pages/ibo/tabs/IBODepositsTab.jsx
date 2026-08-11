import { useEffect, useState, useCallback } from 'react';
import { RefreshCw, ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminDataTable } from '@/components/AdminPrimitives';

const STATUS_COLORS = {
  pending:  'text-gold-light bg-gold-light/10',
  approved: 'text-green-400 bg-green-400/10',
  credited: 'text-green-400 bg-green-400/10',
  rejected: 'text-red-400 bg-red-400/10',
  completed:'text-green-400 bg-green-400/10',
  failed:   'text-red-400 bg-red-400/10',
};

export default function IBODepositsTab() {
  const [items, setItems]     = useState([]);
  const [total, setTotal]     = useState(0);
  const [page, setPage]       = useState(1);
  const [type, setType]       = useState('all');
  const [loading, setLoading] = useState(true);
  const [err, setErr]         = useState(null);
  const LIMIT = 20;

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const res = await api.ibo.getDepositsWithdrawals({ type, page, limit: LIMIT });
      const d = await res.json();
      if (!res.ok) throw new Error(d.detail || 'Failed');
      setItems(d.items || []);
      setTotal(d.total || 0);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }, [type, page]);

  useEffect(() => { load(); }, [load]);

  const pages = Math.max(1, Math.ceil(total / LIMIT));
  const fmtDate = (s) => s ? new Date(s).toLocaleString() : '—';

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex gap-1 p-1 rounded-lg bg-white/5 border border-white/8">
          {['all','deposit','withdrawal'].map((t) => (
            <button key={t} onClick={() => { setType(t); setPage(1); }}
              className={`px-3 py-1.5 rounded text-xs font-semibold capitalize transition-colors ${type === t ? 'bg-gold/20 text-gold-light' : 'text-white/40 hover:text-white'}`}>
              {t === 'all' ? 'All' : t === 'deposit' ? 'Deposits' : 'Withdrawals'}
            </button>
          ))}
        </div>
        <button onClick={load} className="flex items-center gap-1 text-xs text-white/40 hover:text-gold-light transition-colors ml-auto">
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {err && <div className="text-red-400 text-sm py-4 text-center">{err}</div>}

      <AdminDataTable>
          <thead>
            <tr>
              {['Type','UID','Amount','Network','Tx Hash','Status','Date'].map((h) => (
                <th key={h}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={7} className="text-white/30 text-sm text-center !py-8">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={7} className="text-white/30 text-sm text-center !py-8">No {type !== 'all' ? type : 'deposit or withdrawal'} records found</td></tr>
            ) : items.map((row, i) => {
              const sc = STATUS_COLORS[row.status] || 'text-white/50 bg-white/5';
              return (
                <tr key={row.id || i}>
                  <td>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${row._type === 'deposit' ? 'text-green-400 bg-green-400/10' : 'text-orange-400 bg-orange-400/10'}`}>
                      {row._type}
                    </span>
                  </td>
                  <td className="font-mono text-xs text-white/50">{row.uid?.slice(0, 8)}…</td>
                  <td className="font-semibold text-white">
                    {Number(row.amount || 0).toFixed(4)} {((row.asset || '—').toUpperCase() === 'IBO' ? 'Delta' : (row.asset || '—').toUpperCase())}
                  </td>
                  <td className="text-xs text-white/50">{row.network || '—'}</td>
                  <td className="font-mono text-xs text-white/40 max-w-[120px] truncate">{row.tx_hash || '—'}</td>
                  <td>
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${sc}`}>{row.status}</span>
                  </td>
                  <td className="text-xs text-white/40">{fmtDate(row.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
      </AdminDataTable>

      {pages > 1 && (
        <div className="flex items-center gap-2 justify-end text-xs text-white/50">
          <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page === 1} className="p-1 hover:text-white disabled:opacity-30"><ChevronLeft size={14}/></button>
          <span>Page {page} of {pages} ({total} records)</span>
          <button onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page === pages} className="p-1 hover:text-white disabled:opacity-30"><ChevronRight size={14}/></button>
        </div>
      )}
    </div>
  );
}
