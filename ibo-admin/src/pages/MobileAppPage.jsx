import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Smartphone, Upload, Trash2, CheckCircle, XCircle, Download,
  RefreshCw, AlertCircle, FileArchive, Store, Link2,
} from 'lucide-react';
import { api, getStoredToken } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission } from '@/lib/adminAccess';
import { AdminDataTable } from '@/components/AdminPrimitives';

const BACKEND = import.meta.env.VITE_BACKEND_URL || 'http://localhost:8000';

function fmtBytes(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return '—';
  if (v >= 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(2)} MB`;
  if (v >= 1024) return `${(v / 1024).toFixed(1)} KB`;
  return `${v} B`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: 'medium', timeStyle: 'short',
    });
  } catch {
    return iso;
  }
}

export default function MobileAppPage() {
  const { admin } = useAdminAuth();
  const canManage = hasPermission(admin, 'manage_settings');

  const [items, setItems] = useState([]);
  const [published, setPublished] = useState(null);
  const [distribution, setDistribution] = useState('direct_apk');
  const [googlePlayUrl, setGooglePlayUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');

  const [version, setVersion] = useState('');
  const [versionCode, setVersionCode] = useState('');
  const [releaseNotes, setReleaseNotes] = useState('');
  const [publishNow, setPublishNow] = useState(true);
  const [file, setFile] = useState(null);
  const [uploadPct, setUploadPct] = useState(null);
  const fileRef = useRef(null);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await api.mobileAppReleases();
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not load releases');
      setItems(data.items || []);
      setPublished(data.published || null);
      const dist = data.distribution || {};
      setDistribution(dist.distribution || 'direct_apk');
      setGooglePlayUrl(dist.google_play_url || '');
    } catch (e) {
      setErr(e.message || 'Load failed');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const uploadWithProgress = (formData) => new Promise((resolve, reject) => {
    const token = getStoredToken();
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${BACKEND}/api/admin/mobile-app/releases`);
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable) {
        setUploadPct(Math.round((ev.loaded / ev.total) * 100));
      }
    };
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText || '{}'); } catch { /* ignore */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new Error(data.detail || xhr.statusText || 'Upload failed'));
    };
    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });

  const handleUpload = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    setErr('');
    setOk('');
    if (!file) { setErr('Select an APK file'); return; }
    if (!/^\d+\.\d+\.\d+/.test(version.trim())) {
      setErr('Version must look like 1.0.0');
      return;
    }
    const vc = parseInt(versionCode, 10);
    if (!Number.isFinite(vc) || vc < 1) {
      setErr('Version code must be a positive integer (Android versionCode)');
      return;
    }

    const fd = new FormData();
    fd.append('file', file);
    fd.append('version', version.trim());
    fd.append('version_code', String(vc));
    fd.append('release_notes', releaseNotes.trim());
    fd.append('publish', publishNow ? 'true' : 'false');

    setBusy(true);
    setUploadPct(0);
    try {
      await uploadWithProgress(fd);
      setOk(`APK v${version.trim()} uploaded${publishNow ? ' and published' : ''}.`);
      setVersion('');
      setVersionCode('');
      setReleaseNotes('');
      setFile(null);
      if (fileRef.current) fileRef.current.value = '';
      await load();
    } catch (ex) {
      setErr(ex.message || 'Upload failed');
    } finally {
      setBusy(false);
      setUploadPct(null);
    }
  };

  const togglePublish = async (id, next) => {
    if (!canManage) return;
    setBusy(true);
    setErr('');
    try {
      const res = await api.patchMobileRelease(id, { published: next });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Update failed');
      setOk(next ? 'Release is now live on the website.' : 'Release unpublished.');
      await load();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id, ver) => {
    if (!canManage) return;
    if (!window.confirm(`Delete APK v${ver}? This removes the file from disk.`)) return;
    setBusy(true);
    setErr('');
    try {
      const res = await api.deleteMobileRelease(id);
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Delete failed');
      setOk('Release deleted.');
      await load();
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const saveDistribution = async (e) => {
    e.preventDefault();
    if (!canManage) return;
    setErr('');
    setOk('');
    if (distribution === 'google_play' && !googlePlayUrl.trim()) {
      setErr('Enter your Google Play Store listing URL');
      return;
    }
    setBusy(true);
    try {
      const res = await api.patchMobileDistribution({
        distribution,
        google_play_url: googlePlayUrl.trim(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not save distribution settings');
      setDistribution(data.distribution || distribution);
      setGooglePlayUrl(data.google_play_url || '');
      setOk(
        data.distribution === 'google_play'
          ? 'Website will show the Google Play button.'
          : 'Website will offer direct APK download from the server.',
      );
      await load();
    } catch (ex) {
      setErr(ex.message || 'Save failed');
    } finally {
      setBusy(false);
    }
  };

  const downloadHref = (rel, version) => {
    if (!rel) return '#';
    if (rel.startsWith('http')) return rel;
    if (rel.startsWith('/api/')) return `${BACKEND}${rel}`;
    return `${BACKEND}${rel}`;
  };

  return (
    <div className="max-w-5xl mx-auto space-y-8 pb-16">
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-gold/15 border border-gold/30">
            <Smartphone size={22} className="text-gold-light" />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-white tracking-tight">Mobile app</h1>
            <p className="text-sm text-white/50 mt-0.5">
              Choose Google Play or direct APK download on the exchange website.
            </p>
          </div>
        </div>
      </div>

      {canManage && (
        <form onSubmit={saveDistribution} className="rounded-2xl border border-surface-border bg-surface-card p-6 space-y-5">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Store size={18} className="text-gold" /> Website download button
          </h2>
          <p className="text-xs text-white/45 -mt-2">
            Controls what visitors see on the exchange landing page, navbar, and promo popup.
          </p>

          <div className="grid sm:grid-cols-2 gap-3">
            <label className={`block rounded-xl border p-4 cursor-pointer transition-colors ${distribution === 'google_play' ? 'border-gold/50 bg-gold/10' : 'border-surface-border bg-surface-dark hover:border-white/20'}`}>
              <input
                type="radio"
                name="distribution"
                value="google_play"
                checked={distribution === 'google_play'}
                onChange={() => setDistribution('google_play')}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-sm font-bold text-white">
                <Store size={16} className="text-gold-light" />
                Google Play Store
              </span>
              <span className="block text-xs text-white/50 mt-2">
                Shows a Google Play button linking to your Play Store listing.
              </span>
            </label>

            <label className={`block rounded-xl border p-4 cursor-pointer transition-colors ${distribution === 'direct_apk' ? 'border-gold/50 bg-gold/10' : 'border-surface-border bg-surface-dark hover:border-white/20'}`}>
              <input
                type="radio"
                name="distribution"
                value="direct_apk"
                checked={distribution === 'direct_apk'}
                onChange={() => setDistribution('direct_apk')}
                className="sr-only"
              />
              <span className="flex items-center gap-2 text-sm font-bold text-white">
                <Download size={16} className="text-gold-light" />
                Direct APK download
              </span>
              <span className="block text-xs text-white/50 mt-2">
                Users download the published APK directly from your server.
              </span>
            </label>
          </div>

          {distribution === 'google_play' && (
            <label className="block">
              <span className="text-xs font-bold text-white/50 uppercase tracking-wider flex items-center gap-1.5">
                <Link2 size={12} /> Google Play listing URL
              </span>
              <input
                value={googlePlayUrl}
                onChange={(e) => setGooglePlayUrl(e.target.value)}
                placeholder="https://play.google.com/store/apps/details?id=com.ibomobileapp"
                className="mt-1.5 w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white text-sm"
                required
              />
            </label>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gold text-surface-dark font-extrabold text-sm disabled:opacity-40"
          >
            {busy ? 'Saving…' : 'Save distribution setting'}
          </button>
        </form>
      )}

      {distribution === 'google_play' && googlePlayUrl.trim() && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 flex flex-wrap items-center gap-3">
          <CheckCircle size={18} className="text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-bold text-emerald-200">Google Play mode active</p>
            <p className="text-xs text-emerald-200/70 mt-0.5 break-all">{googlePlayUrl.trim()}</p>
          </div>
          <a
            href={googlePlayUrl.trim()}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-sm font-bold hover:bg-emerald-500/30"
          >
            <Store size={16} /> Open listing
          </a>
        </div>
      )}

      {distribution === 'direct_apk' && published?.available && (
        <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 flex flex-wrap items-center gap-3">
          <CheckCircle size={18} className="text-emerald-400 shrink-0" />
          <div className="flex-1 min-w-[200px]">
            <p className="text-sm font-bold text-emerald-200">
              Live on website — v{published.version} (code {published.version_code})
            </p>
            <p className="text-xs text-emerald-200/70 mt-0.5">
              {fmtBytes(published.file_size_bytes)} · SHA256 {String(published.sha256 || '').slice(0, 12)}…
            </p>
          </div>
          <a
            href={downloadHref('/api/mobile-app/download', published.version)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-500/20 border border-emerald-400/40 text-emerald-200 text-sm font-bold hover:bg-emerald-500/30"
            target="_blank"
            rel="noopener noreferrer"
          >
            <Download size={16} /> Test download
          </a>
        </div>
      )}

      {distribution === 'direct_apk' && !published?.available && !loading && (
        <div className="rounded-2xl border border-white/10 bg-white/[0.03] px-5 py-4 flex items-start gap-3">
          <AlertCircle size={18} className="text-gold shrink-0 mt-0.5" />
          <p className="text-sm text-white/70">
            No published APK — the exchange homepage shows <strong className="text-white">Mobile app coming soon</strong>.
          </p>
        </div>
      )}

      {err && (
        <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{err}</div>
      )}
      {ok && (
        <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">{ok}</div>
      )}

      {canManage && (
        <form onSubmit={handleUpload} className="rounded-2xl border border-surface-border bg-surface-card p-6 space-y-5">
          <h2 className="text-lg font-bold text-white flex items-center gap-2">
            <Upload size={18} className="text-gold" /> Upload new APK
          </h2>
          <p className="text-xs text-white/45 -mt-2">
            Files stream in 1 MB chunks (max 200 MB). Only one release can be published at a time.
          </p>

          <div className="grid sm:grid-cols-2 gap-4">
            <label className="block">
              <span className="text-xs font-bold text-white/50 uppercase tracking-wider">Version name</span>
              <input
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                placeholder="1.0.0"
                className="mt-1.5 w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white font-mono text-sm"
                required
              />
            </label>
            <label className="block">
              <span className="text-xs font-bold text-white/50 uppercase tracking-wider">Version code</span>
              <input
                value={versionCode}
                onChange={(e) => setVersionCode(e.target.value.replace(/\D/g, ''))}
                placeholder="1"
                inputMode="numeric"
                className="mt-1.5 w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white font-mono text-sm"
                required
              />
            </label>
          </div>

          <label className="block">
            <span className="text-xs font-bold text-white/50 uppercase tracking-wider">Release notes (optional)</span>
            <textarea
              value={releaseNotes}
              onChange={(e) => setReleaseNotes(e.target.value)}
              rows={3}
              placeholder="Bug fixes, new features…"
              className="mt-1.5 w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-white text-sm resize-none"
            />
          </label>

          <label className="block">
            <span className="text-xs font-bold text-white/50 uppercase tracking-wider">APK file</span>
            <input
              ref={fileRef}
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              onChange={(e) => setFile(e.target.files?.[0] || null)}
              className="mt-1.5 w-full text-sm text-white/70 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:bg-gold/20 file:text-gold-light file:font-bold"
              required
            />
            {file && (
              <p className="text-xs text-white/40 mt-1.5 flex items-center gap-1.5">
                <FileArchive size={12} /> {file.name} · {fmtBytes(file.size)}
              </p>
            )}
          </label>

          <label className="flex items-center gap-2 text-sm text-white/80 cursor-pointer">
            <input
              type="checkbox"
              checked={publishNow}
              onChange={(e) => setPublishNow(e.target.checked)}
              className="rounded border-surface-border"
            />
            Publish immediately (show download on landing page)
          </label>

          {uploadPct != null && (
            <div className="space-y-1">
              <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                <div
                  className="h-full bg-gold transition-all duration-200"
                  style={{ width: `${uploadPct}%` }}
                />
              </div>
              <p className="text-xs text-white/50 text-center">Uploading… {uploadPct}%</p>
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full sm:w-auto px-6 py-3 rounded-xl bg-gold text-surface-dark font-extrabold text-sm disabled:opacity-40"
          >
            {busy ? 'Uploading…' : 'Upload APK'}
          </button>
        </form>
      )}

      <div className="rounded-2xl border border-surface-border bg-surface-card overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-border">
          <h2 className="text-base font-bold text-white">All releases</h2>
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-white/90 text-sm font-bold disabled:opacity-40"
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>

        {loading && !items.length ? (
          <div className="py-12 text-center text-white/40 text-sm">Loading…</div>
        ) : !items.length ? (
          <div className="py-12 text-center text-white/40 text-sm">No APK uploads yet.</div>
        ) : (
          <AdminDataTable className="!border-0 !rounded-none">
            <thead>
                <tr>
                  <th>Version</th>
                  <th>Code</th>
                  <th>Size</th>
                  <th>Status</th>
                  <th>Uploaded</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr key={r.id}>
                    <td className="font-mono font-bold text-white">{r.version}</td>
                    <td className="font-mono text-white/70">{r.version_code}</td>
                    <td className="text-white/60">{fmtBytes(r.file_size_bytes)}</td>
                    <td>
                      {r.published ? (
                        <span className="inline-flex items-center gap-1 text-emerald-400 text-xs font-bold">
                          <CheckCircle size={12} /> Live
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-white/40 text-xs font-bold">
                          <XCircle size={12} /> Draft
                        </span>
                      )}
                    </td>
                    <td className="text-white/50 text-xs">{fmtDate(r.created_at)}</td>
                    <td className="text-right space-x-2 whitespace-nowrap">
                      <a
                        href={downloadHref('/api/mobile-app/download', r.version)}
                        className="inline-flex items-center gap-1 rounded-lg text-xs font-bold text-white/70 hover:bg-white/10"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        <Download size={12} />
                      </a>
                      {canManage && (
                        <>
                          {!r.published ? (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => togglePublish(r.id, true)}
                              className="rounded-lg text-xs font-bold text-emerald-300 hover:bg-emerald-500/15 disabled:opacity-40"
                            >
                              Publish
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => togglePublish(r.id, false)}
                              className="rounded-lg text-xs font-bold text-gold-light hover:bg-gold/15 disabled:opacity-40"
                            >
                              Unpublish
                            </button>
                          )}
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => remove(r.id, r.version)}
                            className="p-1.5 rounded-lg text-red-400 hover:bg-red-500/15 disabled:opacity-40"
                            title="Delete"
                          >
                            <Trash2 size={14} />
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            
          </AdminDataTable>
        )}
      </div>
    </div>
  );
}
