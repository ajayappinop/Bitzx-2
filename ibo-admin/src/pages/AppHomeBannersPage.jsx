import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Image as ImageIcon, Plus, RefreshCw, Save, Trash2, Upload, ChevronUp, ChevronDown,
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

/** Pill toggle — matches Token Listings / other admin settings pages */
function TogglePill({ on, onClick, label, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-lg border px-3.5 py-2 text-xs font-bold transition-colors disabled:opacity-40 ${
        on
          ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
          : 'border-surface-border bg-white/5 text-white/55 hover:text-white/85'
      }`}
    >
      <span className={`h-2 w-2 rounded-sm ${on ? 'bg-emerald-400' : 'bg-white/25'}`} />
      {label}
    </button>
  );
}

const inputCls = 'w-full rounded-xl bg-white/[0.04] border border-surface-border px-3 py-2.5 text-sm text-white placeholder:text-white/30 focus:border-gold/40 outline-none';

const CTA_ACTIONS = [
  { value: 'none', label: 'None' },
  { value: 'markets', label: 'Markets tab' },
  { value: 'trade', label: 'Trade (BTC)' },
  { value: 'wallet', label: 'Wallet' },
  { value: 'wallet_swap', label: 'Wallet → Swap' },
  { value: 'futures', label: 'Futures' },
  { value: 'external', label: 'External URL' },
];

function formatApiDetail(data) {
  const d = data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('; ');
  return data?.message || 'Request failed';
}

const emptyDraft = () => ({
  title: '',
  subtitle: '',
  badge: '',
  cta_label: '',
  cta_action: '',
  cta_url: '',
  enabled: true,
});

/** Only send fields the admin actually filled — avoids default copy on new banners */
function draftToCreateBody(draft) {
  const body = { enabled: draft.enabled !== false };
  const title = String(draft.title ?? '').trim();
  if (title) body.title = title;
  const subtitle = String(draft.subtitle ?? '').trim();
  if (subtitle) body.subtitle = subtitle;
  const badge = String(draft.badge ?? '').trim();
  if (badge) body.badge = badge;
  const ctaLabel = String(draft.cta_label ?? '').trim();
  if (ctaLabel) body.cta_label = ctaLabel;
  const ctaAction = String(draft.cta_action ?? '').trim();
  if (ctaAction) body.cta_action = ctaAction;
  const ctaUrl = String(draft.cta_url ?? '').trim();
  if (ctaUrl) body.cta_url = ctaUrl;
  return body;
}

export default function AppHomeBannersPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_settings');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [settings, setSettings] = useState({ enabled: true, auto_scroll_seconds: 5 });
  const [banners, setBanners] = useState([]);
  const [imageSpec, setImageSpec] = useState({ width: 1200, height: 490 });
  const [draft, setDraft] = useState(emptyDraft());
  const [draftImage, setDraftImage] = useState(null);
  const [draftPreview, setDraftPreview] = useState('');
  const fileRefs = useRef({});
  const draftFileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await api.appHomeBanners();
      const data = await res.json();
      if (!res.ok) throw new Error(formatApiDetail(data));
      setSettings(data.settings || {});
      setBanners(data.banners || []);
      setImageSpec(data.image_spec || { width: 1200, height: 490 });
    } catch (e) {
      setErr(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const saveSettings = async () => {
    if (!canManage) return;
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const res = await api.patchAppHomeBannerSettings({
        enabled: settings.enabled,
        auto_scroll_seconds: Number(settings.auto_scroll_seconds),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(formatApiDetail(data));
      setOk('Carousel settings saved.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const pickDraftImage = (file) => {
    if (!file) return;
    setDraftImage(file);
    if (draftPreview) URL.revokeObjectURL(draftPreview);
    setDraftPreview(URL.createObjectURL(file));
  };

  const createBanner = async () => {
    if (!canManage) return;
    if (!draft.title.trim() && !draftImage) {
      setErr('Enter a title or pick an image (at least one is required).');
      return;
    }
    setBusy(true);
    setErr('');
    setOk('');
    try {
      const res = await api.createAppHomeBanner(draftToCreateBody(draft));
      const data = await res.json();
      if (!res.ok) throw new Error(formatApiDetail(data));
      const bannerId = data.id;
      if (draftImage && bannerId) {
        const uploaded = await uploadImage(bannerId, draftImage, { silent: true });
        setOk(`Banner created. Image on server: ${uploaded?.image_url || '/uploads/home_banners/'}`);
      } else {
        setOk('Banner created — upload a custom image below (auto-resized to 1200×490).');
      }
      setDraft(emptyDraft());
      setDraftImage(null);
      if (draftPreview) URL.revokeObjectURL(draftPreview);
      setDraftPreview('');
      if (draftFileRef.current) draftFileRef.current.value = '';
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const patchBanner = async (id, patch) => {
    const res = await api.patchAppHomeBanner(id, patch);
    const data = await res.json();
      if (!res.ok) throw new Error(formatApiDetail(data));
    return data;
  };

  const uploadImage = async (id, file, opts = {}) => {
    if (!canManage || !file) return;
    if (!opts.silent) {
      setBusy(true);
      setErr('');
    }
    try {
      const token = getStoredToken();
      const fd = new FormData();
      fd.append('file', file);
      const res = await fetch(`${BACKEND}/api/admin/app-home-banners/${encodeURIComponent(id)}/image`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(formatApiDetail(data));
      if (!opts.silent) {
        setOk(`Image saved on server at ${data.image_url || '/uploads/home_banners/'} (1200×490).`);
        await load();
      }
      return data;
    } catch (e) {
      if (!opts.silent) setErr(e.message);
      throw e;
    } finally {
      if (!opts.silent) setBusy(false);
    }
  };

  const deleteBanner = async (id) => {
    if (!canManage || !window.confirm('Delete this banner?')) return;
    setBusy(true);
    try {
      const res = await api.deleteAppHomeBanner(id);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.detail || 'Delete failed');
      }
      await load();
      setOk('Banner removed.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  const moveBanner = async (id, dir) => {
    const idx = banners.findIndex((b) => b.id === id);
    if (idx < 0) return;
    const swapIdx = dir === 'up' ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= banners.length) return;
    const a = banners[idx];
    const b = banners[swapIdx];
    setBusy(true);
    try {
      await patchBanner(a.id, { sort_order: b.sort_order });
      await patchBanner(b.id, { sort_order: a.sort_order });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-white/60 text-sm">Loading home banners…</div>
    );
  }

  return (
    <div className="p-6 max-w-4xl space-y-6">
      <div>
        <Link to="/settings" className="text-xs text-gold-light hover:underline">← Settings</Link>
        <h1 className="text-2xl font-bold text-white mt-2">App home banners</h1>
        <p className="text-sm text-white/55 mt-1">
          Promo carousel on the <strong className="text-white/80">exchange website</strong> (home + dashboard) and{' '}
          <strong className="text-white/80">mobile app</strong>.
          Upload <strong className="text-gold-light">JPEG, PNG, or WebP</strong> — stored on the server under{' '}
          <code className="text-gold-light/90">/uploads/home_banners/</code>, path saved in the database (auto-resized to{' '}
          {imageSpec.width}×{imageSpec.height}).
        </p>
      </div>

      {err ? <p className="text-sm text-red-400">{err}</p> : null}
      {ok ? <p className="text-sm text-emerald-400">{ok}</p> : null}

      <section className="rounded-2xl border border-surface-border bg-surface-card p-5 space-y-4">
        <h2 className="text-sm font-bold uppercase tracking-wide text-white/50">Carousel</h2>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-sm text-white/80">Show carousel on web &amp; app home</span>
          <TogglePill
            label={settings.enabled !== false ? 'On' : 'Off'}
            on={settings.enabled !== false}
            disabled={!canManage}
            onClick={() => setSettings((s) => ({ ...s, enabled: !(s.enabled !== false) }))}
          />
        </div>
        <label className="block text-xs text-white/50">
          Auto-scroll (seconds)
          <input
            type="number"
            min={3}
            max={30}
            className={`${inputCls} mt-1`}
            value={settings.auto_scroll_seconds ?? 5}
            disabled={!canManage}
            onChange={(e) => setSettings((s) => ({ ...s, auto_scroll_seconds: e.target.value }))}
          />
        </label>
        {canManage ? (
          <button
            type="button"
            onClick={saveSettings}
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-xl bg-gold px-4 py-2 text-sm font-bold text-surface-dark"
          >
            <Save size={16} /> Save carousel settings
          </button>
        ) : null}
      </section>

      {canManage ? (
        <section className="rounded-2xl border border-surface-border bg-surface-card p-5 space-y-3">
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/50 flex items-center gap-2">
            <Plus size={16} /> New banner
          </h2>
          <div className="relative">
            <input
              className={inputCls}
              placeholder="Title"
              value={draft.title}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            />
          </div>
          <input className={inputCls} placeholder="Subtitle" value={draft.subtitle} onChange={(e) => setDraft((d) => ({ ...d, subtitle: e.target.value }))} />
          <input className={inputCls} placeholder="Badge" value={draft.badge} onChange={(e) => setDraft((d) => ({ ...d, badge: e.target.value }))} />
          <div className="grid grid-cols-2 gap-3">
            <input className={inputCls} placeholder="CTA label" value={draft.cta_label} onChange={(e) => setDraft((d) => ({ ...d, cta_label: e.target.value }))} />
            <select
              className={inputCls}
              value={draft.cta_action}
              onChange={(e) => setDraft((d) => ({ ...d, cta_action: e.target.value }))}
            >
              <option value="">CTA action</option>
              {CTA_ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>
          {draft.cta_action === 'external' ? (
            <input className={inputCls} placeholder="External URL" value={draft.cta_url} onChange={(e) => setDraft((d) => ({ ...d, cta_url: e.target.value }))} />
          ) : null}

          <div className="rounded-xl border border-dashed border-gold/30 bg-gold/5 p-4 space-y-3">
            <p className="text-xs font-bold text-gold-light uppercase tracking-wide">Custom banner image (optional)</p>
            <p className="text-[11px] text-white/50">
              Wide landscape works best. Server crops to {imageSpec.width}×{imageSpec.height} and stores the file path in MongoDB.
            </p>
            <input
              ref={draftFileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              className="hidden"
              onChange={(e) => pickDraftImage(e.target.files?.[0])}
            />
            {draftPreview ? (
              <img src={draftPreview} alt="Preview" className="w-full max-h-40 object-cover rounded-lg border border-surface-border" />
            ) : null}
            <button
              type="button"
              onClick={() => draftFileRef.current?.click()}
              className="inline-flex items-center gap-2 rounded-lg border border-gold/35 px-3 py-2 text-xs font-bold text-gold-light hover:bg-gold/10"
            >
              <Upload size={14} /> {draftImage ? 'Change image' : 'Choose image file'}
            </button>
          </div>

          <button type="button" onClick={createBanner} disabled={busy} className="rounded-xl bg-gold px-4 py-2 text-sm font-bold text-surface-dark">
            {draftImage ? 'Add banner with image' : 'Add banner'}
          </button>
        </section>
      ) : null}

      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold uppercase tracking-wide text-white/50">Banners ({banners.length})</h2>
          <button type="button" onClick={load} className="text-white/50 hover:text-white"><RefreshCw size={16} /></button>
        </div>
        {banners.length === 0 ? (
          <p className="text-sm text-white/40">No banners yet. Add one above.</p>
        ) : (
          banners.map((b, i) => (
            <div key={b.id} className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
              <div className="relative aspect-[1200/490] max-h-44 bg-surface-dark overflow-hidden">
                {b.image_url ? (
                  <img
                    src={`${assetUrl(b.image_url)}?t=${encodeURIComponent(b.updated_at || b.id)}`}
                    alt=""
                    className="absolute inset-0 h-full w-full object-cover"
                  />
                ) : (
                  <div
                    className="absolute inset-0"
                    style={{ background: `linear-gradient(105deg, ${b.gradient_start}, ${b.gradient_end})` }}
                  />
                )}
                <div className="absolute inset-0 bg-gradient-to-r from-black/70 via-black/45 to-transparent p-4 flex flex-col justify-center">
                  {b.badge ? <span className="text-[10px] font-bold text-gold-light uppercase">{b.badge}</span> : null}
                  <span className="text-lg font-bold text-white">{b.title}</span>
                  {b.subtitle ? <span className="text-xs text-white/70 mt-1 line-clamp-1">{b.subtitle}</span> : null}
                </div>
              </div>
              <div className="p-4 space-y-3">
                <div className="flex flex-wrap gap-2 items-center">
                  <TogglePill
                    label={b.enabled !== false ? 'Active' : 'Hidden'}
                    on={b.enabled !== false}
                    disabled={!canManage}
                    onClick={async () => {
                      const next = b.enabled === false;
                      try {
                        await patchBanner(b.id, { enabled: next });
                        await load();
                      } catch (e) { setErr(e.message); }
                    }}
                  />
                  {canManage ? (
                    <>
                      <button type="button" className="p-1 text-white/40 hover:text-white" onClick={() => moveBanner(b.id, 'up')} disabled={i === 0}><ChevronUp size={18} /></button>
                      <button type="button" className="p-1 text-white/40 hover:text-white" onClick={() => moveBanner(b.id, 'down')} disabled={i === banners.length - 1}><ChevronDown size={18} /></button>
                      <button type="button" className="ml-auto text-red-400" onClick={() => deleteBanner(b.id)}><Trash2 size={16} /></button>
                    </>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="flex flex-wrap gap-2 items-center">
                    <input
                      ref={(el) => { fileRefs.current[b.id] = el; }}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      onChange={(e) => uploadImage(b.id, e.target.files?.[0])}
                    />
                    <button
                      type="button"
                      onClick={() => fileRefs.current[b.id]?.click()}
                      className="inline-flex items-center gap-2 rounded-lg border border-gold/30 px-3 py-1.5 text-xs font-bold text-gold-light"
                    >
                      <Upload size={14} /> Upload image (auto-resize)
                    </button>
                    {b.image_url ? (
                      <code className="text-[10px] text-white/40 break-all">{b.image_url}</code>
                    ) : (
                      <span className="text-xs text-gold/90 flex items-center gap-1"><ImageIcon size={12} /> No file yet — gradient fallback on site</span>
                    )}
                    <button
                      type="button"
                      onClick={() => fileRefs.current[b.id]?.click()}
                      className="text-[10px] font-bold text-white/50 hover:text-gold-light"
                    >
                      Replace image
                    </button>
                  </div>
                ) : null}
              </div>
            </div>
          ))
        )}
      </section>
    </div>
  );
}
