import { useState, useEffect, useCallback } from 'react';
import {
  Gift, Copy, Check, Share2, Users, Coins, Loader2,
  Link2, Network, Layers, RefreshCw, HelpCircle,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { fetchMyReferralInfo } from '@/services/referralApi';
import ReferralNetworkTree from '@/components/referral/ReferralNetworkTree';
import { buildReferralSignupLink } from '@/lib/referral';

function fmtIbo(n) {
  return Number(n || 0).toFixed(4);
}

const HOW_IT_WORKS = [
  {
    n: '1',
    title: 'Share your link',
    body: 'Friends sign up with your code.',
    tone: 'orange',
  },
  {
    n: '2',
    title: 'They verify KYC',
    body: 'Rewards unlock after approval.',
    tone: 'teal',
  },
  {
    n: '3',
    title: 'Earn multi-level',
    body: 'Delta credits as the network grows.',
    tone: 'gold',
  },
];

function LevelTile({ level, highlight }) {
  const label = level.flat_overflow
    ? `L${level.flat_from_level || level.level}+`
    : `L${level.level}`;
  const reward = Number(level.amount_ibo || 0);
  const earned = Number(level.earned_ibo || 0);
  const pending = Number(level.pending_ibo || 0);
  const count = level.referral_count ?? 0;
  const hasActivity = earned > 0 || pending > 0 || count > 0;

  return (
    <div
      className={`refer-level-tile${highlight ? ' is-highlight' : ''}${hasActivity ? ' is-active' : ''}`}
    >
      <div className="refer-level-tile__head">
        <span className="refer-level-tile__badge">{label}</span>
        <span className="refer-level-tile__count">
          {count} invite{count === 1 ? '' : 's'}
        </span>
      </div>
      <p className="refer-level-tile__reward">
        <span className="tabular-nums">{reward.toFixed(4)}</span>
        <span className="refer-level-tile__unit">Delta / signup</span>
      </p>
      <div className="refer-level-tile__stats">
        <span className="is-earned">
          Earned <strong className="tabular-nums">{fmtIbo(earned)}</strong>
        </span>
        <span className={pending > 0 ? 'is-pending' : ''}>
          Pending <strong className="tabular-nums">{fmtIbo(pending)}</strong>
        </span>
      </div>
    </div>
  );
}

export default function ReferAndEarnPage({ accountMode = false } = {}) {
  const { user } = useAuth();
  const [info, setInfo] = useState(null);
  const [tree, setTree] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [copied, setCopied] = useState(false);
  const [shared, setShared] = useState(false);
  const [panel, setPanel] = useState('network'); // network | levels | guide

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

  const shareLink = info
    ? buildReferralSignupLink(info.share_links?.website, info.referral_code)
    : '';
  const levels = info?.summary?.levels || [];

  const markCopied = () => {
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const copyLink = () => {
    if (!shareLink) return;
    navigator.clipboard?.writeText(shareLink).then(markCopied);
  };

  const copyCode = () => {
    if (!info?.referral_code) return;
    navigator.clipboard?.writeText(info.referral_code).then(markCopied);
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
      <div
        className={
          accountMode
            ? 'font-ui flex items-center justify-center min-h-[40vh]'
            : 'ibo-page font-ui flex items-center justify-center min-h-[50vh]'
        }
      >
        <Loader2 className="animate-spin text-[#FE6C02]" size={28} />
      </div>
    );
  }

  return (
    <div className={`refer-hub font-ui ${accountMode ? 'min-w-0' : 'ibo-page'}`}>
      <div
        className={
          accountMode
            ? 'w-full min-w-0 space-y-4'
            : 'w-full max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-6 sm:py-8 space-y-4'
        }
      >
        {/* Toolbar */}
        <div className="delta-account-toolbar !mb-0">
          <div className="flex items-center gap-2 min-w-0">
            <Gift size={16} className="text-[#FE6C02] shrink-0" />
            <div className="min-w-0">
              <h2 className="text-[15px] font-semibold text-[color:var(--ibo-ink)] m-0 leading-tight truncate">
                Refer &amp; Earn
              </h2>
              {!accountMode ? (
                <p className="text-[11px] text-[color:var(--ibo-muted)] mt-0.5 m-0">
                  Multi-level Delta when invites complete KYC
                </p>
              ) : (
                <p className="text-[11px] text-[color:var(--ibo-muted)] mt-0.5 m-0 truncate">
                  Multi-level rewards when invites complete KYC
                </p>
              )}
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            className="wallet-action-ghost text-xs !px-2.5 !py-1.5"
          >
            <RefreshCw size={13} /> Refresh
          </button>
        </div>

        {err ? (
          <div
            className="rounded-xl border border-[#F6465D]/30 bg-[rgba(246,70,93,0.08)] px-4 py-3 text-sm text-[#F6465D] space-y-2"
            role="alert"
          >
            <p className="leading-relaxed m-0">{err}</p>
            <button
              type="button"
              onClick={load}
              className="text-xs font-bold underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        ) : null}

        {info && !info.referral_enabled ? (
          <div className="rounded-xl border border-[color:var(--ibo-border-solid)] px-4 py-3 text-sm text-[color:var(--ibo-ink-secondary)]">
            The Refer &amp; Earn program is not currently active. Check back soon.
          </div>
        ) : null}

        {/* Full-width invite command bar (not a side dock) */}
        {info ? (
          <section className="refer-invite" aria-label="Your invite">
            <div className="refer-invite__code">
              <p className="refer-invite__label">Your code</p>
              <div className="refer-invite__code-row">
                <p className="refer-invite__code-val">{info.referral_code}</p>
                <button
                  type="button"
                  onClick={copyCode}
                  className="refer-invite__icon-btn"
                  title="Copy code"
                >
                  {copied ? (
                    <Check size={15} className="text-[#0ECB81]" />
                  ) : (
                    <Copy size={15} />
                  )}
                </button>
              </div>
            </div>

            <div className="refer-invite__link">
              <p className="refer-invite__label flex items-center gap-1.5">
                <Link2 size={11} /> Signup link
              </p>
              <input
                readOnly
                value={shareLink}
                className="refer-invite__input"
                aria-label="Referral signup link"
                onFocus={(e) => e.target.select()}
              />
            </div>

            <div className="refer-invite__actions">
              <button type="button" onClick={copyLink} className="wallet-action-ghost">
                {copied ? <Check size={15} className="text-[#0ECB81]" /> : <Copy size={15} />}
                {copied ? 'Copied' : 'Copy link'}
              </button>
              <button type="button" onClick={shareLinkNow} className="wallet-action-primary">
                <Share2 size={15} />
                {shared ? 'Ready' : 'Share'}
              </button>
            </div>
          </section>
        ) : !err ? (
          <div className="wallet-surface p-5 text-sm text-[color:var(--ibo-muted)]">
            Sign-in data unavailable. Retry when the network is ready.
          </div>
        ) : null}

        {/* Snapshot metrics — colored highlight cards */}
        {info ? (
          <div className="refer-metrics">
            <div className="refer-metric refer-metric--sky">
              <p className="refer-metric__label">
                <Users size={12} /> Direct
              </p>
              <p className="refer-metric__value">
                {info.summary?.direct_referral_count ?? 0}
              </p>
              <p className="refer-metric__hint">Level 1 invites</p>
            </div>
            <div className="refer-metric refer-metric--violet">
              <p className="refer-metric__label">
                <Network size={12} /> Network
              </p>
              <p className="refer-metric__value">
                {info.summary?.total_referral_count ?? 0}
              </p>
              <p className="refer-metric__hint">All levels</p>
            </div>
            <div className="refer-metric refer-metric--orange is-featured">
              <p className="refer-metric__label">
                <Coins size={12} /> Earned
              </p>
              <p className="refer-metric__value">
                {fmtIbo(info.summary?.total_earned_ibo)}
              </p>
              <p className="refer-metric__hint">Delta in wallet</p>
            </div>
            <div className="refer-metric refer-metric--amber">
              <p className="refer-metric__label">
                <Gift size={12} /> Pending
              </p>
              <p className="refer-metric__value">
                {fmtIbo(info.summary?.total_pending_ibo)}
              </p>
              <p className="refer-metric__hint">Awaiting KYC</p>
            </div>
          </div>
        ) : null}

        {Number(info?.summary?.total_pending_ibo || 0) > 0 ? (
          <div className="refer-pending">
            <Coins size={15} className="text-[#FE6C02] shrink-0" />
            <p className="m-0">
              <strong className="text-[#FE6C02] tabular-nums">
                {fmtIbo(info.summary.total_pending_ibo)} Delta
              </strong>{' '}
              from referrals becomes spendable once they complete KYC.
            </p>
          </div>
        ) : null}

        {/* Content tabs */}
        <div className="delta-account-tabs">
          <button
            type="button"
            onClick={() => setPanel('network')}
            className={`delta-account-tabs__btn${panel === 'network' ? ' is-active' : ''}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Network size={14} /> Network
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPanel('levels')}
            className={`delta-account-tabs__btn${panel === 'levels' ? ' is-active' : ''}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <Layers size={14} /> Levels
              {levels.length > 0 ? (
                <span className="tabular-nums opacity-70 text-[11px]">{levels.length}</span>
              ) : null}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPanel('guide')}
            className={`delta-account-tabs__btn${panel === 'guide' ? ' is-active' : ''}`}
          >
            <span className="inline-flex items-center gap-1.5">
              <HelpCircle size={14} /> How it works
            </span>
          </button>
        </div>

        {panel === 'network' ? (
          <div className="min-w-0">
            {info && user ? (
              <ReferralNetworkTree
                rootUser={user}
                referrals={tree}
                summary={info?.summary}
              />
            ) : !err ? (
              <div className="delta-account-empty">
                <Users className="mx-auto mb-2 opacity-40 text-[color:var(--ibo-muted)]" size={28} />
                <p className="delta-account-empty__title">No network data yet</p>
              </div>
            ) : null}
          </div>
        ) : null}

        {panel === 'levels' ? (
          <section className="space-y-3">
            <p className="text-[12px] text-[color:var(--ibo-muted)] leading-relaxed m-0 max-w-2xl">
              Per-level Delta when a referral under that depth completes KYC.
            </p>
            {levels.length > 0 ? (
              <div className="refer-level-grid">
                {levels.map((lvl, i) => (
                  <LevelTile
                    key={lvl.level}
                    level={lvl}
                    highlight={i === 0 || Number(lvl.earned_ibo || 0) > 0}
                  />
                ))}
              </div>
            ) : (
              <div className="delta-account-empty">
                <p className="delta-account-empty__title">
                  Reward levels will appear once the program schedule is configured.
                </p>
              </div>
            )}
          </section>
        ) : null}

        {panel === 'guide' ? (
          <section className="refer-guide">
            {HOW_IT_WORKS.map((step) => (
              <div key={step.n} className={`refer-guide__step refer-guide__step--${step.tone}`}>
                <span className="refer-guide__num">{step.n}</span>
                <div className="min-w-0">
                  <p className="refer-guide__title">{step.title}</p>
                  <p className="refer-guide__body">{step.body}</p>
                </div>
              </div>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
}
