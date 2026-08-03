import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Sparkles, RefreshCw, Save, Upload, Image as ImageIcon, Smartphone,
} from 'lucide-react';
import { api, getStoredToken } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

function assetUrl(path) {
  if (!path) return null;
  if (path.startsWith('http')) return path;
  return `${BACKEND}${path.startsWith('/') ? '' : '/'}${path}`;
}

function Toggle({ checked, onChange, disabled }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative w-11 h-6 rounded-full transition-colors ${checked ? 'bg-emerald-500' : 'bg-white/20'} ${disabled ? 'opacity-50' : ''}`}
    >
      <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${checked ? 'translate-x-5' : ''}`} />
    </button>
  );
}

function Field({ label, children }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-bold uppercase tracking-wide text-white/50">{label}</span>
      {children}
    </label>
  );
}

const inputCls = 'w-full rounded-xl bg-white/[0.04] border border-surface-border px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-gold/40 outline-none';

export default function LandingPromoPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_settings');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [apk, setApk] = useState(null);

  const [enabled, setEnabled] = useState(true);
  const [autoScroll, setAutoScroll] = useState(4);
  const [dismissHours, setDismissHours] = useState(24);

  const [coin, setCoin] = useState({});
  const [app, setApp] = useState({});

  const coinFileRef = useRef(null);
  const appFileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await api.landingPromo();
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not load promo config');
      const cfg = data.config || {};
      setApk(data.apk || null);
      setEnabled(cfg.enabled !== false);
      setAutoScroll(cfg.auto_scroll_seconds ?? 4);
      setDismissHours(cfg.dismiss_hours ?? 24);
      setCoin(cfg.coin || {});
      setApp(cfg.app || {});
    } catch (e) {
      setErr(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!canManage) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const body = {
        enabled,
        auto_scroll_seconds: Number(autoScroll),
        dismiss_hours: Number(dismissHours),
        coin: {
          enabled: coin.enabled !== false,
          brand_label: coin.brand_label,
          title: coin.title,
          tagline_1: coin.tagline_1,
          tagline_2: coin.tagline_2,
          status_line: coin.status_line,
          event_line: coin.event_line,
          cta_url: coin.cta_url,
          cta_label: coin.cta_label,
        },
        app: {
          enabled: app.enabled !== false,
          headline: app.headline,
          description: app.description,
          subheadline: app.subheadline,
          features: app.features,
          cta_label: app.cta_label,
        },
      };
      const res = await api.patchLandingPromo(body);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Save failed');
      setOk('Landing promo saved.');
      setCoin(data.coin || coin);
      setApp(data.app || app);
    } catch (e) {
      setErr(e.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const uploadImage = async (slot, file) => {
    if (!canManage || !file) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const fd = new FormData();
      fd.append('file', file);
      const token = getStoredToken();
      const headers = {};
      if (token) headers.Authorization = `Bearer ${token}`;
      const res = await fetch(`${BACKEND}/api/admin/landing-promo/image?slot=${slot}`, {
        method: 'POST',
        headers,
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Upload failed');
      if (slot === 'coin') setCoin(data.coin || {});
      else setApp(data.app || {});
      setOk(`${slot === 'coin' ? 'Coin' : 'App'} image uploaded.`);
    } catch (e) {
      setErr(e.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="admin-page flex items-center justify-center min-h-[40vh]">
        <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="admin-page space-y-6 max-w-4xl">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-2">
            <Sparkles className="text-gold-light" size={24} />
            Landing promo popup
          </h1>
          <p className="text-white/55 text-sm mt-1 max-w-2xl">
            Configure the first-visit popup on the exchange landing page: IBO coin slide and Android app slide (auto-rotates every few seconds).
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/settings/mobile-app"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] border border-surface-border text-white/90 text-sm font-bold hover:border-gold/40"
          >
            <Smartphone size={16} className="text-gold-light" />
            Manage APK
          </Link>
          <button type="button" onClick={load} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-white/90 text-sm font-bold">
            <RefreshCw size={16} /> Refresh
          </button>
          {canManage ? (
            <button
              type="button"
              onClick={save}
              disabled={busy}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-50"
            >
              <Save size={16} /> {busy ? 'Saving…' : 'Save changes'}
            </button>
          ) : null}
        </div>
      </div>

      {err ? <p className="text-red-400 text-sm">{err}</p> : null}
      {ok ? <p className="text-emerald-400 text-sm">{ok}</p> : null}

      <section className="rounded-2xl border border-surface-border bg-white/[0.02] p-5 space-y-4">
        <h2 className="text-lg font-bold text-white">Global settings</h2>
        <div className="grid sm:grid-cols-2 gap-4">
          <div className="flex items-center justify-between rounded-xl border border-surface-border px-4 py-3">
            <span className="text-sm text-white/80">Popup enabled</span>
            <Toggle checked={enabled} onChange={setEnabled} disabled={!canManage} />
          </div>
          <Field label="Auto-scroll (seconds)">
            <input type="number" min={2} max={30} className={inputCls} value={autoScroll} onChange={(e) => setAutoScroll(e.target.value)} disabled={!canManage} />
          </Field>
          <Field label="Hide again after dismiss (hours)">
            <input type="number" min={1} max={720} className={inputCls} value={dismissHours} onChange={(e) => setDismissHours(e.target.value)} disabled={!canManage} />
          </Field>
          <div className="rounded-xl border border-surface-border px-4 py-3 text-sm text-white/60">
            Published APK:{' '}
            {apk?.available ? (
              <span className="text-emerald-400 font-semibold">v{apk.version} live</span>
            ) : (
              <span className="text-gold-light">None — app slide shows “coming soon”</span>
            )}
          </div>
        </div>
      </section>

      <section className="rounded-2xl border border-gold/20 bg-gold/[0.04] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Slide 1 — IBO coin</h2>
          <Toggle checked={coin.enabled !== false} onChange={(v) => setCoin({ ...coin, enabled: v })} disabled={!canManage} />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <Field label="Brand label"><input className={inputCls} value={coin.brand_label || ''} onChange={(e) => setCoin({ ...coin, brand_label: e.target.value })} disabled={!canManage} /></Field>
          <Field label="Title"><input className={inputCls} value={coin.title || ''} onChange={(e) => setCoin({ ...coin, title: e.target.value })} disabled={!canManage} /></Field>
          <Field label="Tagline 1"><input className={inputCls} value={coin.tagline_1 || ''} onChange={(e) => setCoin({ ...coin, tagline_1: e.target.value })} disabled={!canManage} /></Field>
          <Field label="Tagline 2"><input className={inputCls} value={coin.tagline_2 || ''} onChange={(e) => setCoin({ ...coin, tagline_2: e.target.value })} disabled={!canManage} /></Field>
          <Field label="Status line"><input className={inputCls} value={coin.status_line || ''} onChange={(e) => setCoin({ ...coin, status_line: e.target.value })} disabled={!canManage} /></Field>
          <Field label="Event line"><input className={inputCls} value={coin.event_line || ''} onChange={(e) => setCoin({ ...coin, event_line: e.target.value })} disabled={!canManage} /></Field>
          <Field label="CTA URL"><input className={inputCls} placeholder="/ibo-markets" value={coin.cta_url || ''} onChange={(e) => setCoin({ ...coin, cta_url: e.target.value })} disabled={!canManage} /></Field>
          <Field label="CTA label"><input className={inputCls} value={coin.cta_label || ''} onChange={(e) => setCoin({ ...coin, cta_label: e.target.value })} disabled={!canManage} /></Field>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {coin.image_url ? (
            <img src={assetUrl(coin.image_url)} alt="" className="h-24 rounded-lg border border-white/10 object-contain bg-black/40" />
          ) : (
            <div className="h-24 w-32 rounded-lg border border-dashed border-white/15 flex items-center justify-center text-white/30 text-xs">
              <ImageIcon size={20} />
            </div>
          )}
          {canManage ? (
            <>
              <input ref={coinFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => uploadImage('coin', e.target.files?.[0])} />
              <button type="button" onClick={() => coinFileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white/90">
                <Upload size={16} /> Upload coin graphic
              </button>
            </>
          ) : null}
        </div>
      </section>

      <section className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.04] p-5 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Slide 2 — Android app</h2>
          <Toggle checked={app.enabled !== false} onChange={(v) => setApp({ ...app, enabled: v })} disabled={!canManage} />
        </div>
        <div className="grid gap-4">
          <Field label="Headline"><input className={inputCls} value={app.headline || ''} onChange={(e) => setApp({ ...app, headline: e.target.value })} disabled={!canManage} /></Field>
          <Field label="Description"><textarea rows={3} className={inputCls} value={app.description || ''} onChange={(e) => setApp({ ...app, description: e.target.value })} disabled={!canManage} /></Field>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Sub-headline"><input className={inputCls} value={app.subheadline || ''} onChange={(e) => setApp({ ...app, subheadline: e.target.value })} disabled={!canManage} /></Field>
            <Field label="Features line"><input className={inputCls} placeholder="Fast | Secure | Real-Time" value={app.features || ''} onChange={(e) => setApp({ ...app, features: e.target.value })} disabled={!canManage} /></Field>
            <Field label="Download link label"><input className={inputCls} value={app.cta_label || ''} onChange={(e) => setApp({ ...app, cta_label: e.target.value })} disabled={!canManage} /></Field>
          </div>
          <p className="text-xs text-white/45">Download URL comes from the published APK on the Mobile app page.</p>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          {app.image_url ? (
            <img src={assetUrl(app.image_url)} alt="" className="h-24 rounded-lg border border-white/10 object-contain bg-black/40" />
          ) : (
            <div className="h-24 w-32 rounded-lg border border-dashed border-white/15 flex items-center justify-center text-white/30 text-xs">
              <ImageIcon size={20} />
            </div>
          )}
          {canManage ? (
            <>
              <input ref={appFileRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => uploadImage('app', e.target.files?.[0])} />
              <button type="button" onClick={() => appFileRef.current?.click()} disabled={busy} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-sm font-bold text-white/90">
                <Upload size={16} /> Upload app graphic
              </button>
            </>
          ) : null}
        </div>
      </section>
    </div>
  );
}
