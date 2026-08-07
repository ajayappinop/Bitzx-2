import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  Search, ChevronLeft, ChevronRight, User, MapPin, Phone, Shield,
  PauseCircle, CirclePause, Ban, CheckCircle, Filter, Loader2,
  ArrowDownToLine, ArrowUpFromLine,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useListSort } from '@/lib/useListSort';

const ACTIVE_OPTS = [
  { value: '', label: 'All accounts' },
  { value: '1', label: 'Active only' },
  { value: '0', label: 'Disabled only' },
];

const KYC_OPTS = [
  { value: '', label: 'All KYC' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'pending', label: 'Pending' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
];

function kycBadgeClass(status) {
  if (status === 'approved') return 'bg-green-500/15 text-green-400 border-green-500/20';
  if (status === 'pending') return 'bg-gold/15 text-gold border-gold/20';
  if (status === 'rejected') return 'bg-red-500/15 text-red-400 border-red-500/20';
  return 'bg-white/10 text-white/60 border-white/10';
}

function formatFlowAmount(n) {
  const x = Number(n);
  if (!Number.isFinite(x)) return '0';
  if (Math.abs(x) >= 1) return x.toLocaleString(undefined, { maximumFractionDigits: 8 });
  return x.toLocaleString(undefined, { maximumSignificantDigits: 8 });
}

/** Approved-flow totals: { USDT: 100, BTC: 0.01 } → display string */
function formatTotalsByAsset(totals) {
  if (!totals || typeof totals !== 'object') return '—';
  const parts = Object.entries(totals)
    .filter(([, v]) => Number(v) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([a, v]) => `${a} ${formatFlowAmount(v)}`);
  return parts.length ? parts.join(' · ') : '—';
}

export default function UsersPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [q, setQ] = useState(searchParams.get('q') || '');
  const [active, setActive] = useState(searchParams.get('active') || '');
  const [kyc, setKyc] = useState(searchParams.get('kyc') || '');
  const [country, setCountry] = useState(searchParams.get('country') || '');
  const [featPause, setFeatPause] = useState(searchParams.get('feat') || '');
  const [tradePause, setTradePause] = useState(searchParams.get('trad') || '');
  const [dateFrom, setDateFrom] = useState(searchParams.get('date_from') || '');
  const [dateTo, setDateTo] = useState(searchParams.get('date_to') || '');
  const [items, setItems] = useState([]);
  const [total, setTotal] = useState(0);
  const [listStats, setListStats] = useState({ deposit_totals: {}, withdrawal_totals: {} });
  const [skip, setSkip] = useState(0);
  const [limit, setLimit] = useState(Number(searchParams.get('limit') || 25));
  const [loading, setLoading] = useState(true);
  const [suggest, setSuggest] = useState([]);
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedUid, setSelectedUid] = useState('');
  const wrapRef = useRef(null);
  const { sortBy, sortDir, sortParams, toggleSort: _toggleSort, resetSort } = useListSort(
    searchParams.get('sort') || 'created_at',
    searchParams.get('dir') === 'asc' ? 'asc' : 'desc',
  );
  const toggleSort = useCallback(
    (key) => {
      setSkip(0);
      _toggleSort(key);
    },
    [_toggleSort],
  );

  const selectedUser = useMemo(
    () => items.find((u) => u.uid === selectedUid) || items[0] || null,
    [items, selectedUid],
  );

  useEffect(() => {
    if (!items.length) {
      setSelectedUid('');
      return;
    }
    if (!items.some((u) => u.uid === selectedUid)) {
      setSelectedUid(items[0].uid);
    }
  }, [items, selectedUid]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { skip: String(skip), limit: String(limit) };
      if (q.trim()) params.q = q.trim();
      if (active === '1') params.is_active = 'true';
      if (active === '0') params.is_active = 'false';
      if (kyc) params.kyc_status = kyc;
      if (country.trim()) params.country = country.trim();
      if (featPause === '1') params.features_paused = 'true';
      if (featPause === '0') params.features_paused = 'false';
      if (tradePause === '1') params.trading_paused = 'true';
      if (tradePause === '0') params.trading_paused = 'false';
      if (dateFrom) params.created_from = `${dateFrom}T00:00:00`;
      if (dateTo) params.created_to = `${dateTo}T23:59:59`;
      Object.assign(params, sortParams);
      const r = await api.users(params);
      if (!r.ok) throw new Error('Failed to load users');
      const data = await r.json();
      setItems(data.items || []);
      setTotal(data.total ?? 0);
      setListStats({
        deposit_totals: data.stats?.deposit_totals || {},
        withdrawal_totals: data.stats?.withdrawal_totals || {},
      });
    } catch {
      setItems([]);
      setTotal(0);
      setListStats({ deposit_totals: {}, withdrawal_totals: {} });
    } finally {
      setLoading(false);
    }
  }, [q, active, kyc, country, featPause, tradePause, dateFrom, dateTo, skip, limit, sortParams]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const p = new URLSearchParams();
    if (q.trim()) p.set('q', q.trim());
    if (active) p.set('active', active);
    if (kyc) p.set('kyc', kyc);
    if (country.trim()) p.set('country', country.trim());
    if (featPause) p.set('feat', featPause);
    if (tradePause) p.set('trad', tradePause);
    if (dateFrom) p.set('date_from', dateFrom);
    if (dateTo) p.set('date_to', dateTo);
    p.set('limit', String(limit));
    p.set('sort', sortBy);
    p.set('dir', sortDir);
    setSearchParams(p, { replace: true });
  }, [q, active, kyc, country, featPause, tradePause, dateFrom, dateTo, limit, sortBy, sortDir, setSearchParams]);

  useEffect(() => {
    if (!q.trim() || q.length < 2) {
      setSuggest([]);
      setSuggestLoading(false);
      return;
    }
    let cancelled = false;
    setSuggestLoading(true);
    const query = q.trim();
    const t = setTimeout(async () => {
      try {
        const r = await api.searchUsers(query);
        if (cancelled) return;
        if (r.ok) setSuggest(await r.json());
        else setSuggest([]);
      } catch {
        if (!cancelled) setSuggest([]);
      } finally {
        if (!cancelled) setSuggestLoading(false);
      }
    }, 220);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [q]);

  useEffect(() => {
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setShowSuggest(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const pages = Math.max(1, Math.ceil(total / limit));
  const page = Math.floor(skip / limit) + 1;

  const exportUsersExcel = async () => {
    setExporting(true);
    try {
      const rows = [];
      let nextSkip = 0;
      const batchLimit = 200;
      while (true) {
        const params = { skip: String(nextSkip), limit: String(batchLimit) };
        if (q.trim()) params.q = q.trim();
        if (active === '1') params.is_active = 'true';
        if (active === '0') params.is_active = 'false';
        if (kyc) params.kyc_status = kyc;
        if (country.trim()) params.country = country.trim();
        if (featPause === '1') params.features_paused = 'true';
        if (featPause === '0') params.features_paused = 'false';
        if (tradePause === '1') params.trading_paused = 'true';
        if (tradePause === '0') params.trading_paused = 'false';
        if (dateFrom) params.created_from = `${dateFrom}T00:00:00`;
        if (dateTo) params.created_to = `${dateTo}T23:59:59`;
        const r = await api.users(params);
        if (!r.ok) throw new Error('Failed to export users');
        const data = await r.json();
        const batch = Array.isArray(data.items) ? data.items : [];
        rows.push(...batch);
        nextSkip += batch.length;
        if (batch.length < batchLimit || nextSkip >= (Number(data.total) || 0)) break;
      }
      const header = ['Name', 'Email', 'UID', 'Status', 'KYC', 'Country', '2FA', 'Joined'];
      const toCell = (v) => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      const bodyRows = rows.map((u) => {
        const statusText = u.is_active === false ? 'Banned' : (u.account_frozen_scope ? 'Restricted' : ((u.user_features_paused || u.user_trading_paused) ? 'Suspended' : 'Active'));
        return [
          u.name || '',
          u.email || '',
          u.uid || '',
          statusText,
          u.kyc_status || 'unverified',
          u.country || '',
          u.two_factor_enabled ? 'Yes' : 'No',
          u.created_at ? new Date(u.created_at).toLocaleString() : '',
        ];
      });
      const html = `<table><thead><tr>${header.map((h) => `<th>${toCell(h)}</th>`).join('')}</tr></thead><tbody>${
        bodyRows.map((r) => `<tr>${r.map((c) => `<td>${toCell(c)}</td>`).join('')}</tr>`).join('')
      }</tbody></table>`;
      const blob = new Blob([`\ufeff${html}`], { type: 'application/vnd.ms-excel;charset=utf-8;' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `users_export_${new Date().toISOString().slice(0, 10)}.xls`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(a.href);
    } catch {
      // Keep this page low-noise: table remains available even if export fails.
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="admin-page">
      <h1 className="admin-title mb-2">User Management</h1>
      <p className="admin-page-lead mb-6 sm:mb-8">
        Search customer accounts by email, name, UID, phone, or deposit wallet address; apply risk filters; open a profile for actions.
      </p>

      <div className="rounded-2xl border border-surface-border bg-surface-card/80 p-4 sm:p-5 mb-6 space-y-4">
        <div className="flex items-center gap-2 text-base font-semibold text-white/85">
          <Filter size={16} className="text-gold-light/80" />
          User search and filters
        </div>

        <div className="flex flex-col xl:flex-row gap-3 xl:items-start">
          <div className="relative flex-1" ref={wrapRef}>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-white/35 z-10" size={18} />
            <input
              value={q}
              onChange={(e) => { setSkip(0); setQ(e.target.value); setShowSuggest(true); }}
              onFocus={() => setShowSuggest(true)}
              placeholder="Search email, name, UID, phone, or deposit wallet address…"
              className="w-full pl-10 pr-4 py-3 rounded-xl bg-surface-dark border border-surface-border text-white placeholder:text-white/35 focus:border-gold/40 outline-none"
              autoComplete="off"
            />
            {showSuggest && (q.trim().length >= 2 || suggestLoading) && (
              <div className="absolute z-30 top-full mt-1 left-0 right-0 rounded-xl border border-surface-border bg-surface-card shadow-xl overflow-hidden">
                {suggestLoading ? (
                  <div className="flex items-center gap-2 px-4 py-4 text-white/55 text-sm">
                    <Loader2 size={18} className="animate-spin text-gold-light" />
                    Searching…
                  </div>
                ) : suggest.length === 0 ? (
                  <p className="px-4 py-3 text-sm text-white/45">No matching users. Press Enter or wait for the table to refresh.</p>
                ) : (
                  <ul className="max-h-72 overflow-y-auto scrollbar-thin">
                    <li className="px-3 py-2 text-sm font-semibold text-white/70 border-b border-surface-border bg-white/[.02]">
                      Suggestions — click a row to open the profile
                    </li>
                    {suggest.map((s) => (
                      <li key={s.uid} className="border-b border-surface-border/60 last:border-0">
                        <Link
                          to={`/users/${s.uid}`}
                          className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 py-3 hover:bg-white/[.06] text-sm"
                          onClick={() => setShowSuggest(false)}
                        >
                          <div className="flex items-center gap-2 min-w-0 flex-1">
                            <User size={16} className="text-gold-light shrink-0" />
                            <span className="text-white font-bold truncate">{s.name || s.email || '—'}</span>
                            <span className={`shrink-0 text-[10px] font-extrabold uppercase px-2 py-0.5 rounded border ${kycBadgeClass(s.kyc_status)}`}>
                              {s.kyc_status || 'unverified'}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-white/50 sm:justify-end">
                            <span className="truncate max-w-[200px]" title={s.email}>{s.email}</span>
                            {s.matched_via_deposit_address ? (
                              <span className="inline-flex items-center gap-1 shrink-0 text-gold-light/90 font-semibold">
                                Deposit address match
                              </span>
                            ) : null}
                            {s.phone ? (
                              <span className="inline-flex items-center gap-1 shrink-0">
                                <Phone size={12} className="opacity-50" />
                                {s.phone}
                              </span>
                            ) : null}
                            {s.country ? (
                              <span className="inline-flex items-center gap-1 shrink-0">
                                <MapPin size={12} className="opacity-50" />
                                {s.country}
                              </span>
                            ) : null}
                            {!s.is_active ? (
                              <span className="inline-flex items-center gap-1 text-red-300/90 font-semibold">
                                <Ban size={12} /> Disabled
                              </span>
                            ) : null}
                            <span className="font-mono text-[10px] text-white/40">{s.uid}</span>
                          </div>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 xl:w-[640px]">
            <select
              value={active}
              onChange={(e) => { setSkip(0); setActive(e.target.value); }}
              className="rounded-xl bg-surface-dark border border-surface-border px-4 py-3 text-white text-sm font-semibold"
              title="All accounts"
            >
              {ACTIVE_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <select
              value={kyc}
              onChange={(e) => { setSkip(0); setKyc(e.target.value); }}
              className="rounded-xl bg-surface-dark border border-surface-border px-4 py-3 text-white text-sm font-semibold"
              title="All KYC"
            >
              {KYC_OPTS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={exportUsersExcel}
              disabled={exporting}
              className="adm-btn-secondary"
            >
              {exporting ? 'Exporting…' : 'Export'}
            </button>
            <div className="rounded-xl border border-surface-border px-4 py-3 text-white/60 text-sm font-semibold flex items-center justify-center">
              User actions in profile
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={() => {
              setSkip(0);
              setQ('');
              setActive('');
              setKyc('');
              setCountry('');
              setFeatPause('');
              setTradePause('');
              setDateFrom('');
              setDateTo('');
              resetSort();
            }}
            className="adm-btn-secondary"
          >
            Clear filters
          </button>
          <p className="text-xs text-white/45">
            Search suggestions appear after 2+ characters. Deposit and withdrawal columns show <strong className="text-white/55">approved</strong> request totals, per asset.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mb-4 text-sm text-white/65">
        <span>
          Total records: <strong className="text-white">{total}</strong>
        </span>
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" title="Approved deposits for all users matching current filters">
          <span className="inline-flex items-center gap-1 text-white/50">
            <ArrowDownToLine size={14} className="text-emerald-400/90 shrink-0" />
            Total deposits:
          </span>
          <strong className="text-emerald-200/95 font-mono text-xs sm:text-sm">{formatTotalsByAsset(listStats.deposit_totals)}</strong>
        </span>
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1" title="Approved withdrawals (gross amount) for all users matching current filters">
          <span className="inline-flex items-center gap-1 text-white/50">
            <ArrowUpFromLine size={14} className="text-gold/90 shrink-0" />
            Total withdrawals:
          </span>
          <strong className="text-gold-light/95 font-mono text-xs sm:text-sm">{formatTotalsByAsset(listStats.withdrawal_totals)}</strong>
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 mb-6">
        <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-emerald-200/80">Active users</p>
          <p className="text-2xl font-black text-emerald-100 mt-1">{items.filter((u) => u.is_active !== false).length}</p>
        </div>
        <div className="rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-red-200/80">Disabled users</p>
          <p className="text-2xl font-black text-red-100 mt-1">{items.filter((u) => u.is_active === false).length}</p>
        </div>
        <div className="rounded-xl border border-gold/25 bg-gold/10 px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-gold-light/80">KYC pending</p>
          <p className="text-2xl font-black text-gold-light/90 mt-1">{items.filter((u) => u.kyc_status === 'pending').length}</p>
        </div>
        <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 px-4 py-3">
          <p className="text-xs uppercase tracking-wider text-sky-200/80">Trading paused</p>
          <p className="text-2xl font-black text-sky-100 mt-1">{items.filter((u) => !!u.user_trading_paused).length}</p>
        </div>
      </div>

      <div className="rounded-lg border border-surface-border bg-surface-card overflow-hidden min-w-0">
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-surface-border bg-[color:var(--ibo-thead)]">
          <span className="text-[10px] font-bold uppercase tracking-wider text-white/40 mr-1">Sort</span>
          {[
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'kyc_status', label: 'KYC' },
            { key: 'last_login_at', label: 'Last login' },
            { key: 'created_at', label: 'Joined' },
          ].map(({ key, label }) => {
            const activeSort = sortBy === key;
            return (
              <button
                key={key}
                type="button"
                onClick={() => toggleSort(key)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition-colors ${
                  activeSort
                    ? 'border-[#FE6C02]/40 bg-[#FE6C02]/10 text-[#8f3600]'
                    : 'border-surface-border text-white/55 hover:text-white hover:bg-surface-hover'
                }`}
              >
                {label}{activeSort ? (sortDir === 'asc' ? ' ↑' : ' ↓') : ''}
              </button>
            );
          })}
        </div>

        {loading ? (
          <div className="px-4 py-20 text-center text-white/50 text-sm">Loading…</div>
        ) : items.length === 0 ? (
          <div className="px-4 py-20 text-center text-white/50 text-sm">No users match.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-[minmax(260px,34%)_1fr] min-h-[420px]">
            {/* Left directory */}
            <div className="border-b lg:border-b-0 lg:border-r border-surface-border max-h-[520px] overflow-y-auto scrollbar-thin bg-[color:var(--ibo-bg)]">
              <ul>
                {items.map((u) => {
                  const selected = (selectedUser?.uid || '') === u.uid;
                  return (
                    <li key={u.uid}>
                      <button
                        type="button"
                        onClick={() => setSelectedUid(u.uid)}
                        className={`w-full text-left px-3 py-2.5 border-b border-surface-border/70 transition-colors ${
                          selected
                            ? 'bg-[#FE6C02]/10 border-l-2 border-l-[#FE6C02]'
                            : 'hover:bg-surface-hover border-l-2 border-l-transparent'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className={`font-semibold text-[13px] truncate ${selected ? 'text-[#8f3600]' : 'text-[color:var(--ibo-ink)]'}`}>
                            {u.name || '—'}
                          </p>
                          <span className={`shrink-0 text-[9px] font-extrabold uppercase px-1.5 py-0.5 rounded border ${kycBadgeClass(u.kyc_status)}`}>
                            {u.kyc_status || 'unverified'}
                          </span>
                        </div>
                        <p className="text-[11px] text-white/55 truncate mt-0.5">{u.email || '—'}</p>
                        <p className="text-[10px] font-mono text-white/35 truncate mt-0.5">{u.uid}</p>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>

            {/* Right inspector */}
            <div className="p-4 sm:p-5 min-w-0 bg-surface-card">
              {selectedUser ? (
                <div className="space-y-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <div className="w-11 h-11 rounded-lg border border-[#FE6C02]/30 bg-[#FE6C02]/10 text-[#8f3600] flex items-center justify-center font-black text-sm shrink-0">
                          {(selectedUser.name || selectedUser.email || '?')
                            .split(/\s+/)
                            .filter(Boolean)
                            .slice(0, 2)
                            .map((p) => p[0]?.toUpperCase())
                            .join('') || '?'}
                        </div>
                        <div className="min-w-0">
                          <h3 className="text-lg font-black text-[color:var(--ibo-ink)] truncate">{selectedUser.name || '—'}</h3>
                          <p className="text-[11px] font-mono text-white/45 truncate">{selectedUser.uid}</p>
                        </div>
                      </div>
                      <div className="mt-3 space-y-1 text-[12px]">
                        <p className="text-white/70 break-all">{selectedUser.email || '—'}</p>
                        {selectedUser.phone ? (
                          <p className="text-white/50 inline-flex items-center gap-1.5">
                            <Phone size={12} /> {selectedUser.phone}
                          </p>
                        ) : null}
                        {selectedUser.country ? (
                          <p className="text-white/50 inline-flex items-center gap-1.5">
                            <MapPin size={12} /> {selectedUser.country}
                          </p>
                        ) : null}
                      </div>
                    </div>
                    <Link
                      to={`/users/${selectedUser.uid}`}
                      className="adm-btn-primary"
                    >
                      Open profile <ChevronRight size={14} />
                    </Link>
                  </div>

                  <div className="flex flex-wrap gap-1.5">
                    <span className={`text-[10px] font-extrabold uppercase px-2 py-1 rounded-md border inline-flex items-center gap-1 ${kycBadgeClass(selectedUser.kyc_status)}`}>
                      <Shield size={11} /> {selectedUser.kyc_status || 'unverified'}
                    </span>
                    <span className={`text-[10px] font-bold px-2 py-1 rounded-md border inline-flex items-center gap-1 ${
                      selectedUser.is_active !== false
                        ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                        : 'border-red-500/30 bg-red-500/10 text-red-500'
                    }`}>
                      {selectedUser.is_active !== false ? <CheckCircle size={11} /> : <Ban size={11} />}
                      {selectedUser.is_active !== false ? 'Active' : 'Disabled'}
                    </span>
                    {selectedUser.two_factor_enabled ? (
                      <span className="text-[10px] font-extrabold uppercase px-2 py-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 text-emerald-600">2FA</span>
                    ) : null}
                    {selectedUser.user_features_paused ? (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md border border-gold/30 bg-gold/10 text-[#8f3600] inline-flex items-center gap-1">
                        <PauseCircle size={11} /> Features paused
                      </span>
                    ) : null}
                    {selectedUser.user_trading_paused ? (
                      <span className="text-[10px] font-bold px-2 py-1 rounded-md border border-[#FE6C02]/30 bg-[#FE6C02]/10 text-[#8f3600] inline-flex items-center gap-1">
                        <CirclePause size={11} /> Trading paused
                      </span>
                    ) : null}
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="rounded-md border border-surface-border bg-[color:var(--ibo-bg)] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 inline-flex items-center gap-1.5">
                        <ArrowDownToLine size={12} className="text-emerald-500" /> Approved deposits
                      </p>
                      <p className="mt-2 text-sm font-mono font-semibold text-emerald-600 break-words">
                        {formatTotalsByAsset(selectedUser.deposit_totals)}
                      </p>
                    </div>
                    <div className="rounded-md border border-surface-border bg-[color:var(--ibo-bg)] p-3">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/40 inline-flex items-center gap-1.5">
                        <ArrowUpFromLine size={12} className="text-[#FE6C02]" /> Approved withdrawals
                      </p>
                      <p className="mt-2 text-sm font-mono font-semibold text-[#8f3600] break-words">
                        {formatTotalsByAsset(selectedUser.withdrawal_totals)}
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 text-[12px]">
                    <div className="rounded-md border border-surface-border px-3 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Last login</p>
                      <p className="mt-1 text-white/75">
                        {selectedUser.last_login_at
                          ? new Date(selectedUser.last_login_at).toLocaleString()
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded-md border border-surface-border px-3 py-2.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-white/40">Joined</p>
                      <p className="mt-1 text-white/75">
                        {selectedUser.created_at
                          ? new Date(selectedUser.created_at).toLocaleString()
                          : '—'}
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="h-full min-h-[280px] flex items-center justify-center text-white/45 text-sm">
                  <span className="inline-flex items-center gap-2"><User size={16} /> Select a user</span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mt-4 gap-3">
        <p className="text-white/50 text-sm text-center sm:text-left">{total} users · page {page} / {pages}</p>
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full sm:w-auto">
          <select
            value={String(limit)}
            onChange={(e) => { setSkip(0); setLimit(Number(e.target.value)); }}
            className="rounded-xl bg-surface-card border border-surface-border px-3 py-2 text-white text-sm font-semibold w-full sm:w-auto min-w-0"
          >
            {[10, 25, 50, 100].map((n) => <option key={n} value={n}>{n}/page</option>)}
          </select>
          <div className="flex gap-2 justify-center sm:justify-start">
            <button
              type="button"
              disabled={skip <= 0}
              onClick={() => setSkip((s) => Math.max(0, s - limit))}
              className="adm-btn-secondary"
            >
              <ChevronLeft size={16} /> Prev
            </button>
            <button
              type="button"
              disabled={skip + limit >= total}
              onClick={() => setSkip((s) => s + limit)}
              className="adm-btn-secondary"
            >
              Next <ChevronRight size={16} />
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
