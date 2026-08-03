import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Gift, Copy, Check, Share2, Users, Coins, Loader2,
  Link2, Network, Layers, ArrowRight, RefreshCw,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { fetchMyReferralInfo } from '@/services/referralApi';
import ReferralNetworkTree from '@/components/referral/ReferralNetworkTree';
import { buildReferralSignupLink } from '@/lib/referral';

function fmtIbo(n) {
  return Number(n || 0).toFixed(4);
}

function MetricStripItem({ label, value, hint, strong }) {
  return (
    <div className="min-w-0 flex-1 px-5 py-4 sm:px-6 sm:py-5">
      <p className="text-[10px] sm:text-[11px] font-semibold uppercase tracking-[0.12em] text-[color:var(--ibo-muted)] truncate">
        {label}
      </p>
      <p className={`mt-1.5 text-xl sm:text-2xl font-bold tabular-nums tracking-tight break-words ${
        strong ? 'text-[#FE6C02]' : 'text-[color:var(--ibo-ink)]'
      }`}>
        {value}
      </p>
      {hint ? (
        <p className="mt-1 text-[11px] text-[color:var(--ibo-muted)] truncate">{hint}</p>
      ) : null}
    </div>
  );
}

function LevelRailItem({ level, isLast }) {
  const label = level.flat_overflow
    ? `L${level.flat_from_level || level.level}+`
    : `L${level.level}`;
  const reward = Number(level.amount_ibo || 0);
  const earned = Number(level.earned_ibo || 0);
  const pending = Number(level.pending_ibo || 0);
  const count = level.referral_count ?? 0;

  return (
    <div className="relative flex gap-4 sm:gap-5">
      <div className="flex flex-col items-center shrink-0 w-10">
        <div className="flex h-10 w-10 items-center justify-center rounded-full border border-[#FE6C02]/35 bg-[#FE6C02]/10 text-[12px] font-bold text-[#FE6C02] tabular-nums">
          {label}
        </div>
        {!isLast ? (
          <div className="w-px flex-1 min-h-[1.25rem] bg-gradient-to-b from-[#FE6C02]/40 to-[color:var(--ibo-border-solid)]" />
        ) : null}
      </div>
      <div className={`flex-1 min-w-0 pb-5 ${isLast ? 'pb-0' : ''}`}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <p className="text-sm font-semibold text-[color:var(--ibo-ink)]">
            {reward.toFixed(4)} <span className="text-[color:var(--ibo-muted)] font-medium">Delta / signup</span>
          </p>
          <p className="text-xs text-[color:var(--ibo-muted)]">{count} referral{count === 1 ? '' : 's'}</p>
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12px] tabular-nums">
          <span className="text-[#FE6C02] font-semibold">Earned {fmtIbo(earned)}</span>
          <span className="text-[color:var(--ibo-ink-secondary)]">Pending {fmtIbo(pending)}</span>
        </div>
      </div>
    </div>
  );
}

const HOW_IT_WORKS = [
  { n: '01', title: 'Share your link', body: 'Friends sign up with your code.' },
  { n: '02', title: 'They verify', body: 'Rewards unlock after KYC approval.' },
  { n: '03', title: 'Earn multi-level', body: 'Delta credits flow as the network grows.' },
];

export default function ReferAndEarnPage() {
  const { user } = useAuth();
  const [info, setInfo] = useState(null);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [panel, setPanel] = useState('network'); // network | levels

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const res = await fetchMyReferralInfo();
      setInfo(res);
      setTree(res.referrals || []);
    } catch (e) {
      setErr(e.message || 'Could not load referral data');
      setInfo(null);
      setTree([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const shareLink = info ? buildReferralSignupLink(info.share_links?.website, info.referral_code) : '';
  const levels = info?.summary?.levels || [];

  const copyLink = () => {
    if (!shareLink) return;
    navigator.clipboard?.writeText(shareLink).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  const shareLinkNow = async () => {
    if (!shareLink) return;
    const shareData = {
      title: 'Join Delta',
      text: 'Sign up on Delta with my referral link and start trading!',
      url: shareLink,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* cancelled */
      }
    }
    copyLink();
    setShared(true);
    setTimeout(() => setShared(false), 1800);
  };

  if (loading) {
    return (
      <div className="ibo-page font-ui flex items-center justify-center min-h-[50vh]">
        <Loader2 className="animate-spin text-[#FE6C02]" size={32} />
      </div>
    );
  }

  return (
    <div className="ibo-page font-ui relative">
      {/* Atmospheric band — not a hero marketing collage, just page depth */}
      <div
        className="pointer-events-none absolute inset-x-0 top-0 h-[320px] opacity-90"
        style={{
          background:
            'radial-gradient(ellipse 80% 70% at 15% -10%, rgba(254,108,2,0.14), transparent 55%), radial-gradient(ellipse 50% 50% at 90% 20%, rgba(14,203,129,0.05), transparent 50%)',
        }}
      />

      <div className="relative w-full min-w-0 px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 pt-5 sm:pt-7 pb-16">
        <div className="w-full max-w-7xl mx-auto min-w-0">

          {/* Compact masthead — brand-forward, single job */}
          <header className="mb-6 sm:mb-8 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div className="min-w-0">
              <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-[#FE6C02]">
                <Gift size={13} strokeWidth={2.25} />
                Delta Rewards
              </div>
              <h1 className="mt-2 text-[1.75rem] sm:text-[2.15rem] font-bold tracking-tight text-[color:var(--ibo-ink)] leading-none">
                Refer &amp; Earn
              </h1>
              <p className="mt-2 text-sm text-[color:var(--ibo-ink-secondary)] max-w-xl leading-relaxed">
                Multi-level Delta when people you invite complete KYC.
              </p>
            </div>
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-2 self-start sm:self-auto text-xs font-semibold text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink)] border border-[color:var(--ibo-border-solid)] rounded-lg px-3 py-2 transition-colors"
            >
              <RefreshCw size={13} /> Refresh
            </button>
          </header>

          {err ? (
            <div className="mb-6 rounded-xl border border-[#F6465D]/30 bg-[#F6465D]/08 px-4 py-3 text-sm text-[#F6465D] space-y-2">
              <p className="leading-relaxed">{err}</p>
              <button type="button" onClick={load} className="text-xs font-bold underline underline-offset-2">
                Retry
              </button>
            </div>
          ) : null}

          {info && !info.referral_enabled ? (
            <div className="mb-6 rounded-xl border border-[color:var(--ibo-border-solid)] px-4 py-3 text-sm text-[color:var(--ibo-ink-secondary)]">
              The Refer &amp; Earn program is not currently active. Check back soon!
            </div>
          ) : null}

          {/* Split layout: invite dock | workspace */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">

            {/* ── Left: sticky invite dock ── */}
            <aside className="lg:col-span-4 xl:col-span-4 lg:sticky lg:top-20 space-y-4">
              <motion.section
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35 }}
                className="rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] p-5 sm:p-6 relative overflow-hidden"
              >
                <div
                  className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full opacity-40"
                  style={{ background: 'radial-gradient(circle, rgba(254,108,2,0.25), transparent 70%)' }}
                />

                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ibo-muted)]">
                  Your invite
                </p>

                {info ? (
                  <>
                    <div className="mt-4 flex items-end justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[11px] text-[color:var(--ibo-muted)] mb-1">Code</p>
                        <p className="text-2xl sm:text-3xl font-mono font-bold tracking-[0.12em] text-[#FE6C02] break-all leading-none">
                          {info.referral_code}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          if (!info.referral_code) return;
                          navigator.clipboard?.writeText(info.referral_code).then(() => {
                            setCopied(true);
                            setTimeout(() => setCopied(false), 1800);
                          });
                        }}
                        className="shrink-0 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-ink-secondary)] hover:text-[#FE6C02] hover:border-[#FE6C02]/40 transition-colors"
                        title="Copy code"
                      >
                        {copied ? <Check size={15} className="text-[#0ECB81]" /> : <Copy size={15} />}
                      </button>
                    </div>

                    <div className="mt-5">
                      <p className="text-[11px] text-[color:var(--ibo-muted)] mb-1.5 flex items-center gap-1.5">
                        <Link2 size={12} /> Signup link
                      </p>
                      <div className="rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] overflow-hidden">
                        <input
                          readOnly
                          value={shareLink}
                          className="w-full bg-transparent px-3 py-2.5 font-mono text-[11px] sm:text-xs text-[color:var(--ibo-ink-secondary)] outline-none"
                        />
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={copyLink}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-[color:var(--ibo-border-solid)] px-3 py-2.5 text-sm font-semibold text-[color:var(--ibo-ink)] hover:bg-white/[0.04] transition-colors"
                      >
                        {copied ? <Check size={15} className="text-[#0ECB81]" /> : <Copy size={15} />}
                        {copied ? 'Copied' : 'Copy'}
                      </button>
                      <button
                        type="button"
                        onClick={shareLinkNow}
                        className="inline-flex items-center justify-center gap-1.5 rounded-xl bg-[#FE6C02] px-3 py-2.5 text-sm font-semibold text-white hover:bg-[#ff7a1a] transition-colors"
                      >
                        <Share2 size={15} />
                        {shared ? 'Ready' : 'Share'}
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="mt-4 text-sm text-[color:var(--ibo-muted)]">
                    Sign-in data unavailable. Retry when the network is ready.
                  </p>
                )}
              </motion.section>

              {/* How it works — vertical steps, not card grid */}
              <section className="rounded-2xl border border-[color:var(--ibo-border-solid)] p-5 space-y-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[color:var(--ibo-muted)]">
                  How it works
                </p>
                <ol className="space-y-3">
                  {HOW_IT_WORKS.map((step) => (
                    <li key={step.n} className="flex gap-3">
                      <span className="font-mono text-[11px] font-bold text-[#FE6C02]/80 pt-0.5 tabular-nums shrink-0">
                        {step.n}
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-[color:var(--ibo-ink)]">{step.title}</p>
                        <p className="text-xs text-[color:var(--ibo-muted)] mt-0.5 leading-relaxed">{step.body}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            </aside>

            {/* ── Right: earnings workspace ── */}
            <div className="lg:col-span-8 xl:col-span-8 min-w-0 space-y-5">

              {info ? (
                <motion.section
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.35, delay: 0.05 }}
                  className="rounded-2xl border border-[color:var(--ibo-border-solid)] overflow-hidden"
                >
                  {/* Single continuous metric band — not 4 cards */}
                  <div className="flex flex-col sm:flex-row sm:divide-x divide-y sm:divide-y-0 divide-[color:var(--ibo-border-solid)]">
                    <MetricStripItem
                      label="Direct"
                      value={info.summary?.direct_referral_count ?? 0}
                      hint="Level 1 invites"
                    />
                    <MetricStripItem
                      label="Network"
                      value={info.summary?.total_referral_count ?? 0}
                      hint="All levels"
                    />
                    <MetricStripItem
                      label="Earned"
                      value={`${fmtIbo(info.summary?.total_earned_ibo)} Delta`}
                      strong
                      hint="In your wallet"
                    />
                    <MetricStripItem
                      label="Pending"
                      value={`${fmtIbo(info.summary?.total_pending_ibo)} Delta`}
                      strong
                      hint="Awaiting KYC"
                    />
                  </div>
                </motion.section>
              ) : null}

              {Number(info?.summary?.total_pending_ibo || 0) > 0 ? (
                <div className="flex gap-3 rounded-xl border border-[#FE6C02]/25 bg-[#FE6C02]/06 px-4 py-3 text-sm text-[color:var(--ibo-ink-secondary)] leading-relaxed">
                  <Coins size={16} className="text-[#FE6C02] shrink-0 mt-0.5" />
                  <p>
                    <span className="font-semibold text-[#FE6C02] tabular-nums">
                      {fmtIbo(info.summary.total_pending_ibo)} Delta
                    </span>
                    {' '}is already on-chain for your referrals — it becomes spendable once they complete KYC.
                  </p>
                </div>
              ) : null}

              {/* Tab switch for levels vs network — different from stacked sections */}
              <div className="flex flex-wrap items-center gap-2 border-b border-[color:var(--ibo-border-solid)] pb-0">
                <button
                  type="button"
                  onClick={() => setPanel('network')}
                  className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                    panel === 'network'
                      ? 'border-[#FE6C02] text-[color:var(--ibo-ink)]'
                      : 'border-transparent text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink-secondary)]'
                  }`}
                >
                  <Network size={15} /> Network
                </button>
                <button
                  type="button"
                  onClick={() => setPanel('levels')}
                  className={`inline-flex items-center gap-1.5 px-3 sm:px-4 py-2.5 text-sm font-semibold border-b-2 -mb-px transition-colors ${
                    panel === 'levels'
                      ? 'border-[#FE6C02] text-[color:var(--ibo-ink)]'
                      : 'border-transparent text-[color:var(--ibo-muted)] hover:text-[color:var(--ibo-ink-secondary)]'
                  }`}
                >
                  <Layers size={15} /> Reward levels
                  {levels.length > 0 ? (
                    <span className="text-[10px] font-bold tabular-nums text-[color:var(--ibo-muted)] ml-0.5">
                      {levels.length}
                    </span>
                  ) : null}
                </button>
              </div>

              {panel === 'network' && info && user ? (
                <motion.div
                  key="network"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25 }}
                  className="min-w-0"
                >
                  <ReferralNetworkTree
                    rootUser={user}
                    referrals={tree}
                    summary={info?.summary}
                  />
                </motion.div>
              ) : null}

              {panel === 'network' && !info && !err ? (
                <div className="rounded-2xl border border-dashed border-[color:var(--ibo-border-solid)] px-6 py-14 text-center">
                  <Users className="mx-auto text-[color:var(--ibo-muted)] mb-3 opacity-50" size={32} />
                  <p className="text-sm text-[color:var(--ibo-muted)]">No network data yet.</p>
                </div>
              ) : null}

              {panel === 'levels' ? (
                <motion.div
                  key="levels"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.25 }}
                  className="rounded-2xl border border-[color:var(--ibo-border-solid)] p-5 sm:p-6"
                >
                  {levels.length > 0 ? (
                    <>
                      <div className="flex items-start justify-between gap-3 mb-6">
                        <div>
                          <h2 className="text-sm font-bold text-[color:var(--ibo-ink)]">Commission ladder</h2>
                          <p className="text-xs text-[color:var(--ibo-muted)] mt-1 max-w-md leading-relaxed">
                            Per-level Delta payout when a referral under that depth completes KYC.
                          </p>
                        </div>
                        <ArrowRight size={16} className="text-[#FE6C02] shrink-0 mt-0.5 opacity-70 hidden sm:block" />
                      </div>
                      <div>
                        {levels.map((lvl, i) => (
                          <LevelRailItem
                            key={lvl.level}
                            level={lvl}
                            isLast={i === levels.length - 1}
                          />
                        ))}
                      </div>
                    </>
                  ) : (
                    <p className="text-sm text-[color:var(--ibo-muted)] py-8 text-center">
                      Reward levels will appear once the program schedule is configured.
                    </p>
                  )}
                </motion.div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
