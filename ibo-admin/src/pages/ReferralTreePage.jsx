import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Search, Gift, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api';
import { AdminPageHeader, AdminPanel } from '@/components/AdminPrimitives';
import AdminReferralNetworkTree from '@/components/AdminReferralNetworkTree';

export default function ReferralTreePage() {
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') || '');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const search = useCallback(async (query) => {
    const query2 = (query || '').trim();
    if (!query2) return;
    setLoading(true);
    setErr('');
    try {
      const r = await api.referralTreeSearch(query2);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'No user matched that search');
      setData(j);
    } catch (e) {
      setErr(e.message);
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = params.get('q');
    if (initial) search(initial);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (e) => {
    e.preventDefault();
    setParams(q ? { q } : {});
    search(q);
  };

  const viewTreeFor = (uid) => {
    setQ(uid);
    setParams({ q: uid });
    search(uid);
  };

  return (
    <div className="space-y-6">
      <AdminPageHeader
        icon={Gift}
        title="Refer & Earn — Referral Tree"
        subtitle="Search any user to inspect their full referral network — direct signups and every downstream branch."
      />

      <form onSubmit={onSubmit} className="flex gap-3 max-w-xl">
        <input
          type="text"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by UID, email, name, or referral code…"
          className="flex-1 rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
        />
        <button
          type="submit"
          disabled={loading}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-40"
        >
          <Search size={16} /> {loading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {err ? <p className="text-red-400 text-sm">{err}</p> : null}

      {data ? (
        <>
          {Array.isArray(data.upline) && data.upline.length > 0 ? (
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-white/50">
              <span className="font-bold uppercase tracking-wide text-white/35">Upline</span>
              {data.upline.map((u, i) => (
                <span key={u.uid} className="inline-flex items-center gap-1.5">
                  {i > 0 ? <ChevronRight size={12} className="text-white/25" /> : null}
                  <button
                    type="button"
                    onClick={() => viewTreeFor(u.uid)}
                    className="font-semibold text-white/70 hover:text-gold-light"
                  >
                    {u.name || u.email || u.uid}
                  </button>
                </span>
              ))}
              <ChevronRight size={12} className="text-white/25" />
              <span className="font-bold text-gold-light">{data.root.name || data.root.email}</span>
            </div>
          ) : null}

          <AdminPanel title="Root user" subtitle={`Referral code: ${data.root.referral_code}`}>
            <div className="flex flex-wrap gap-8">
              <div>
                <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Name / Email</p>
                <Link to={`/users/${encodeURIComponent(data.root.uid)}`} className="text-sm font-bold text-white hover:text-gold-light">
                  {data.root.name || data.root.email}
                </Link>
                {data.root.email ? (
                  <p className="text-xs text-white/45 mt-0.5">{data.root.email}</p>
                ) : null}
              </div>
              <div>
                <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Direct referrals</p>
                <p className="text-lg font-extrabold text-white">{data.summary?.direct_referral_count ?? 0}</p>
              </div>
              <div>
                <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Total downstream</p>
                <p className="text-lg font-extrabold text-white">{data.summary?.total_referral_count ?? 0}</p>
              </div>
              <div>
                <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Total earned</p>
                <p className="text-lg font-extrabold text-gold-light">{Number(data.summary?.total_earned_ibo || 0).toFixed(4)} IBO</p>
              </div>
              <div>
                <p className="text-[11px] font-extrabold text-white/40 uppercase tracking-wider mb-1">Pending (awaiting KYC)</p>
                <p className="text-lg font-extrabold text-gold">{Number(data.summary?.total_pending_ibo || 0).toFixed(4)} IBO</p>
              </div>
            </div>
          </AdminPanel>

          <AdminPanel
            title="Full network graph"
            subtitle="Org-chart view of direct and indirect referrals. Click any user to open their admin profile."
          >
            <AdminReferralNetworkTree
              rootUser={data.root}
              referrals={data.referrals}
              summary={data.summary}
            />
          </AdminPanel>
        </>
      ) : null}
    </div>
  );
}
