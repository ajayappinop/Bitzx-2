import { useEffect, useState } from 'react';
import {
  ShieldCheck, Zap, TrendingUp, Users, Award, ChevronRight,
  Loader2, AlertCircle, CheckCircle2, Clock, Star, Lock,
} from 'lucide-react';
import { p2pApi } from '@/services/p2pApi';

const BENEFITS = [
  { icon: ShieldCheck, color: '#22c55e', bg: 'rgba(34,197,94,0.1)',  border: 'rgba(34,197,94,0.25)',  title: 'Verified Badge',     desc: 'Blue verified shield on your profile — builds instant trust with buyers and sellers.' },
  { icon: Zap,         color: '#0EA4AB', bg: 'rgba(14,164,171,0.1)', border: 'rgba(14,164,171,0.25)', title: 'Higher Limits',      desc: 'Post higher-volume ads and transact larger amounts per order.' },
  { icon: TrendingUp,  color: '#0EA4AB', bg: 'rgba(167,139,250,0.1)',border: 'rgba(14,164,171,0.25)',title: 'Priority Listing',   desc: 'Your ads appear at the top of search results, driving more trade flow.' },
  { icon: Users,       color: '#fb923c', bg: 'rgba(251,146,60,0.1)', border: 'rgba(251,146,60,0.25)', title: 'Dedicated Support',  desc: '24×7 priority support with faster dispute resolution times.' },
  { icon: Award,       color: '#0EA4AB', bg: 'rgba(14,164,171,0.1)', border: 'rgba(14,164,171,0.25)', title: 'Lower Fees',         desc: 'Enjoy reduced platform fees on all P2P trades as a verified merchant.' },
  { icon: Star,        color: '#5BB8FF', bg: 'rgba(14,164,171,0.08)',border: 'rgba(14,164,171,0.2)',  title: 'Reputation Score',   desc: 'Dedicated merchant leaderboard visibility to attract more counter-parties.' },
];

const REQUIREMENTS = [
  { icon: CheckCircle2, text: 'Minimum 30-day account age' },
  { icon: CheckCircle2, text: 'Complete KYC verification (Level 2)' },
  { icon: CheckCircle2, text: 'At least 50 completed P2P orders' },
  { icon: CheckCircle2, text: 'Order completion rate ≥ 90%' },
  { icon: CheckCircle2, text: 'No active bans or disputes in last 90 days' },
];

export default function P2PMerchantPage() {
  const [status, setStatus]   = useState(null);
  const [form, setForm]       = useState({ volume_usd: '', experience: '', why: '' });
  const [busy, setBusy]       = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError]     = useState('');

  useEffect(() => {
    p2pApi.merchantStatus().then(setStatus).catch(() => setStatus({ is_merchant: false, merchant_status: null }));
  }, []);

  const submit = async () => {
    if (!form.why.trim()) { setError('Please explain why you want to become a merchant.'); return; }
    setBusy(true); setError('');
    try {
      await p2pApi.applyMerchant({
        monthly_volume_usd: parseFloat(form.volume_usd) || 0,
        trading_experience: form.experience.trim(),
        application_reason: form.why.trim(),
      });
      setSuccess(true);
    } catch (e) {
      const msg = e.detail || e.message;
      setError(Array.isArray(msg) ? msg.map((d) => d.msg || JSON.stringify(d)).join(' · ') : String(msg));
    }
    finally { setBusy(false); }
  };

  return (
    <div className="ibo-page font-ui">
      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6 sm:py-8 pb-16">

        {/* ── Hero ─────────────────────────────────────────────────── */}
        <div className="relative overflow-hidden rounded-2xl border border-[color:var(--ibo-border-solid)] p-8 sm:p-10 mb-8 text-center"
          style={{ background: 'linear-gradient(160deg, var(--ibo-card) 0%, color-mix(in srgb, var(--ibo-card) 94%, #5BB8FF) 50%, var(--ibo-card) 100%)' }}>
          <div className="pointer-events-none absolute inset-0"
            style={{ background: 'radial-gradient(ellipse 60% 50% at 50% 0%,rgba(14,164,171,0.15),transparent)' }} />
          <div className="pointer-events-none absolute top-0 left-0 right-0 h-px"
            style={{ background: 'linear-gradient(90deg,transparent,rgba(14,164,171,0.5) 50%,transparent)' }} />

          <div className="relative mx-auto max-w-xl">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-5 mx-auto"
              style={{ background: 'rgba(14,164,171,0.12)', border: '2px solid rgba(14,164,171,0.25)', boxShadow: '0 0 30px rgba(14,164,171,0.15)' }}>
              <ShieldCheck size={28} className="text-[#5BB8FF]" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold text-[color:var(--ibo-ink)] mb-3 tracking-tight" style={{ fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}>
              Become a P2P Merchant
            </h1>
            <p className="text-[color:var(--ibo-muted)] text-base leading-relaxed">
              Unlock elite trading privileges with the verified merchant badge — build trust, grow volume, and earn more.
            </p>
          </div>
        </div>

        {/* ── Current status ───────────────────────────────────────── */}
        {status?.is_merchant && (
          <div className="flex items-center gap-4 rounded-2xl p-5 mb-7"
            style={{ background: 'rgba(14,164,171,0.07)', border: '1px solid rgba(14,164,171,0.2)', boxShadow: '0 0 30px rgba(14,164,171,0.05)' }}>
            <div className="w-12 h-12 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'rgba(14,164,171,0.12)', border: '1px solid rgba(14,164,171,0.25)' }}>
              <ShieldCheck size={22} className="text-[#5BB8FF]" />
            </div>
            <div>
              <p className="text-[#5BB8FF] font-extrabold text-base">Verified Merchant</p>
              <p className="text-white/55 text-sm mt-0.5">
                You are an active P2P merchant. Your profile shows the verified badge on all ads.
                {status.merchant_since && <> Active since {new Date(status.merchant_since).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}.</>}
              </p>
            </div>
          </div>
        )}

        {status?.merchant_status === 'pending' && (
          <div className="flex items-center gap-4 rounded-2xl p-5 mb-7"
            style={{ background: 'rgba(91,184,255,0.08)', border: '1px solid rgba(91,184,255,0.22)' }}>
            <Clock size={20} className="text-[#5BB8FF] shrink-0" />
            <div>
              <p className="text-[#5BB8FF] font-bold text-sm">Application Under Review</p>
              <p className="text-[color:var(--ibo-muted)] text-sm mt-0.5">Our team will review your application within 1–3 business days.</p>
            </div>
          </div>
        )}

        {/* ── Benefits grid ────────────────────────────────────────── */}
        <h2 className="text-[color:var(--ibo-ink)] font-extrabold text-xl mb-4" style={{ fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}>
          Merchant Benefits
        </h2>
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4 mb-10">
          {BENEFITS.map(({ icon: Icon, color, bg, border, title, desc }) => (
            <div key={title} className="ibo-hover-lift ibo-hover-glow rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-5 space-y-3">
              <div className="w-11 h-11 rounded-xl flex items-center justify-center"
                style={{ background: bg, border: `1px solid ${border}` }}>
                <Icon size={18} style={{ color }} />
              </div>
              <p className="text-white font-bold text-sm">{title}</p>
              <p className="text-white/50 text-xs leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>

        <div className="grid lg:grid-cols-[1fr,420px] gap-6">

          {/* Requirements */}
          <div className="rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-6">
            <h3 className="text-white font-bold text-base mb-5 flex items-center gap-2">
              <Lock size={15} className="text-[#5BB8FF]" /> Eligibility Requirements
            </h3>
            <div className="space-y-3">
              {REQUIREMENTS.map(({ icon: Icon, text }) => (
                <div key={text} className="flex items-start gap-3">
                  <Icon size={15} className="text-green-400 shrink-0 mt-0.5" />
                  <p className="text-sm text-white/70 leading-relaxed">{text}</p>
                </div>
              ))}
            </div>
            <div className="mt-6 rounded-xl p-4"
              style={{ background: 'rgba(14,164,171,0.06)', border: '1px solid rgba(14,164,171,0.15)' }}>
              <p className="text-xs text-white/55 leading-relaxed">
                Applications are reviewed manually. Meeting the requirements doesn't guarantee approval.
                Our team may request additional information before making a decision.
              </p>
            </div>
          </div>

          {/* Application form */}
          <div className="rounded-2xl p-6 space-y-5"
            style={{
              background: 'linear-gradient(160deg, var(--ibo-card) 0%, var(--ibo-elevated) 100%)',
              border: '1px solid rgba(14,164,171,0.18)',
              boxShadow: '0 8px 40px rgba(0,0,0,0.4), inset 0 1px 0 rgba(255,255,255,0.04)',
            }}>

            {status?.is_merchant ? (
              <div className="text-center py-4">
                <ShieldCheck size={40} className="mx-auto mb-3 text-[#5BB8FF]" />
                <p className="text-white font-bold">You're already a verified merchant!</p>
                <p className="text-white/45 text-sm mt-1">Enjoy all the benefits of your merchant status.</p>
              </div>
            ) : status?.merchant_status === 'pending' ? (
              <div className="text-center py-4">
                <Clock size={40} className="mx-auto mb-3 text-gold" />
                <p className="text-white font-bold">Application Pending</p>
                <p className="text-white/45 text-sm mt-1">We'll notify you when your application is reviewed.</p>
              </div>
            ) : success ? (
              <div className="text-center py-4">
                <CheckCircle2 size={40} className="mx-auto mb-3 text-green-400" />
                <p className="text-white font-bold text-lg">Application Submitted!</p>
                <p className="text-white/55 text-sm mt-1">We'll review it within 1–3 business days and notify you via email.</p>
              </div>
            ) : (
              <>
                <h3 className="text-white font-extrabold text-base" style={{ fontFamily: "Inter, 'Plus Jakarta Sans', system-ui, sans-serif" }}>
                  Apply for Merchant Status
                </h3>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">
                    Monthly Trading Volume (USD)
                  </label>
                  <input type="number" min="0" value={form.volume_usd}
                    onChange={(e) => setForm((f) => ({ ...f, volume_usd: e.target.value }))}
                    placeholder="e.g. 10000"
                    className="w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm placeholder:text-[color:var(--ibo-muted)] focus:outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">
                    Trading Experience
                  </label>
                  <select value={form.experience} onChange={(e) => setForm((f) => ({ ...f, experience: e.target.value }))}
                    className="w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm focus:outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors">
                    <option value="">Select experience level</option>
                    <option value="beginner">Beginner (&lt; 1 year)</option>
                    <option value="intermediate">Intermediate (1–3 years)</option>
                    <option value="experienced">Experienced (3–5 years)</option>
                    <option value="professional">Professional (5+ years)</option>
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">
                    Why do you want to be a merchant? *
                  </label>
                  <textarea rows={3} value={form.why}
                    onChange={(e) => setForm((f) => ({ ...f, why: e.target.value }))}
                    placeholder="Tell us about your trading goals and why you'd be a valuable merchant…"
                    className="w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm placeholder:text-[color:var(--ibo-muted)] resize-none focus:outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors"
                  />
                </div>

                {error && (
                  <div className="flex items-start gap-2.5 rounded-xl p-3.5 text-red-400 text-sm"
                    style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
                    <AlertCircle size={13} className="shrink-0 mt-0.5" />{error}
                  </div>
                )}

                <button onClick={submit} disabled={busy}
                  className="ibo-hover-scale w-full py-3.5 rounded-xl text-sm font-extrabold inline-flex items-center justify-center gap-2 disabled:opacity-40 transition-all text-[#050a1a]"
                  style={{ background: 'linear-gradient(135deg,#0EA4AB,#5BB8FF)', boxShadow: '0 4px 24px rgba(14,164,171,0.3)' }}>
                  {busy && <Loader2 size={14} className="animate-spin" />}
                  Submit Application <ChevronRight size={14} />
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
