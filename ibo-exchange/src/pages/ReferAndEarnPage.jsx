import { useState, useEffect, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Gift, Copy, Check, Share2, Users, Coins, Loader2,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { fetchMyReferralInfo } from '@/services/referralApi';
import ReferralNetworkTree from '@/components/referral/ReferralNetworkTree';
import { buildReferralSignupLink } from '@/lib/referral';

const cardShell =
  'rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] shadow-[var(--ibo-shadow)] min-w-0';

function LevelRow({ level }) {
  const label = level.flat_overflow
    ? `Level ${level.flat_from_level || level.level}+`
    : `Level ${level.level}`;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 px-3 sm:px-4 py-3 text-sm border-b border-[color:var(--ibo-border-solid)] last:border-0">
      <span className="font-bold text-ink">{label}</span>
      <span className="text-ink-secondary">{Number(level.amount_ibo || 0).toFixed(4)} IBO</span>
      <span className="text-ink-secondary hidden sm:block">{level.referral_count ?? 0} users</span>
      <span className="text-gold font-semibold hidden sm:block">{Number(level.earned_ibo || 0).toFixed(4)} IBO</span>
      <span className="text-gold font-semibold hidden sm:block">{Number(level.pending_ibo || 0).toFixed(4)} IBO</span>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, accent }) {
  return (
    <div className={`${cardShell} p-4 sm:p-5`}>
      <div className="flex items-center gap-2 text-ink-muted mb-1 min-w-0">
        <Icon size={16} className="text-gold shrink-0" />
        <span className="text-xs font-bold uppercase tracking-wide truncate">{label}</span>
      </div>
      <p className={`text-xl sm:text-2xl font-extrabold tabular-nums break-words ${accent || 'text-ink'}`}>
        {value}
      </p>
    </div>
  );
}

export default function ReferAndEarnPage() {
  const { user } = useAuth();
  const [info, setInfo] = useState(null);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);

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
      title: 'Join IBO',
      text: 'Sign up on IBO with my referral link and start trading!',
      url: shareLink,
    };
    if (navigator.share) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        // user cancelled or share failed — fall back to copy
      }
    }
    copyLink();
    setShared(true);
    setTimeout(() => setShared(false), 1800);
  };

  if (loading) {
    return (
      <div className="ibo-page font-ui flex items-center justify-center min-h-[50vh]">
        <Loader2 className="animate-spin text-gold" size={32} />
      </div>
    );
  }

  return (
    <div className="ibo-page font-ui">
      <div className="w-full min-w-0 px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 py-6 sm:py-8 pb-16">
        <div className="w-full max-w-6xl mx-auto space-y-5 sm:space-y-6 min-w-0">

          <div className="ibo-account-hero !mb-0">
            <p className="ibo-eyebrow mb-1.5 flex items-center gap-1.5">
              <Gift size={12} /> Rewards
            </p>
            <h1 className="ibo-account-title">Refer &amp; Earn</h1>
            <p className="ibo-account-subtitle max-w-3xl">
              Invite friends and earn IBO for every level of your referral network — when your referral completes KYC, you get rewarded.
            </p>
          </div>

          {err ? (
            <div className="ibo-notice-danger !text-sm space-y-3">
              <p className="leading-relaxed">{err}</p>
              <button
                type="button"
                onClick={load}
                className="ibo-btn-outline !px-3 !py-1.5 text-xs !border-red-400/40 !text-red-500 hover:!bg-red-500/10"
              >
                Retry
              </button>
            </div>
          ) : null}

          {info && !info.referral_enabled ? (
            <div className="ibo-notice-info !text-sm">
              The Refer &amp; Earn program is not currently active. Check back soon!
            </div>
          ) : null}

          {info ? (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className={`${cardShell} p-4 sm:p-5 lg:p-6`}
            >
              <p className="ibo-field-label">Your referral code</p>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-2xl font-mono font-extrabold text-gold tracking-wider break-all">
                  {info.referral_code}
                </span>
              </div>

              <p className="ibo-field-label mt-5">Your referral link</p>
              <div className="flex flex-col sm:flex-row flex-wrap items-stretch sm:items-center gap-2 min-w-0">
                <input
                  readOnly
                  value={shareLink}
                  className="ibo-input flex-1 min-w-0 font-mono text-sm !py-2.5"
                />
                <div className="flex gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={copyLink}
                    className="ibo-btn-outline !px-3.5 !py-2.5 text-sm"
                  >
                    {copied ? <Check size={16} className="text-emerald-500" /> : <Copy size={16} />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                  <button
                    type="button"
                    onClick={shareLinkNow}
                    className="ibo-btn-primary !px-4 !py-2.5 text-sm"
                  >
                    <Share2 size={16} />
                    {shared ? 'Copied for sharing' : 'Share'}
                  </button>
                </div>
              </div>
            </motion.div>
          ) : null}

          {info ? (
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 min-w-0">
              <StatCard
                icon={Users}
                label="Direct referrals"
                value={info.summary?.direct_referral_count ?? 0}
              />
              <StatCard
                icon={Users}
                label="Total network"
                value={info.summary?.total_referral_count ?? 0}
              />
              <StatCard
                icon={Coins}
                label="Total earned"
                value={`${Number(info.summary?.total_earned_ibo || 0).toFixed(4)} IBO`}
                accent="text-gold"
              />
              <StatCard
                icon={Coins}
                label="Pending (awaiting KYC)"
                value={`${Number(info.summary?.total_pending_ibo || 0).toFixed(4)} IBO`}
                accent="text-gold"
              />
            </div>
          ) : null}

          {Number(info?.summary?.total_pending_ibo || 0) > 0 ? (
            <div className="ibo-notice-info !text-sm">
              You have {Number(info.summary.total_pending_ibo).toFixed(4)} IBO already sent on-chain and waiting in your referral rewards —
              it will land in your spendable wallet as soon as the referred user(s) complete KYC verification.
            </div>
          ) : null}

          {/* Only show network when API data loaded — avoids empty tree under error banners */}
          {info && user ? (
            <div className="space-y-3 min-w-0">
              <h2 className="text-sm font-extrabold text-ink uppercase tracking-wide">Your referral network</h2>
              <ReferralNetworkTree
                rootUser={user}
                referrals={tree}
                summary={info?.summary}
              />
            </div>
          ) : null}

          {levels.length > 0 ? (
            <div className={`${cardShell} overflow-hidden`}>
              <div className="px-3 sm:px-4 py-3 border-b border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-elevated)]">
                <h2 className="text-sm font-extrabold text-ink uppercase tracking-wide">Reward levels</h2>
              </div>
              <div className="hidden sm:grid sm:grid-cols-5 gap-2 px-4 py-2 text-xs font-bold text-ink-muted uppercase tracking-wide border-b border-[color:var(--ibo-border-solid)]">
                <span>Level</span>
                <span>Reward</span>
                <span>Referrals</span>
                <span>Earned</span>
                <span>Pending</span>
              </div>
              {levels.map((lvl) => <LevelRow key={lvl.level} level={lvl} />)}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
