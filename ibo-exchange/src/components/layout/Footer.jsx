import { Link } from 'react-router-dom';
import { Send, Mail, Shield, Zap, ExternalLink } from 'lucide-react';
import DunsRegisteredSeal from './DunsRegisteredSeal';

import BrandLogo from '@/components/ui/BrandLogo';
import { SITE_CONFIG } from '@/lib/siteConfig';

const SUPPORT_EMAIL = SITE_CONFIG.supportEmail;

const LINKS = {
  Exchange: [
    { label: 'Futures', to: '/futures/BTCUSDT-PERP' },
    { label: 'Options', to: '/options/BTCUSDT' },
    { label: 'Spot', to: '/trade/IBOUSDT' },
    { label: 'Markets', to: '/markets' },
    { label: 'Deposit INR', to: '/wallet/deposit/inr' },
  ],
  Company: [
    { label: 'Whitepaper', href: 'https://ibo.io/whitepaper' },
    { label: 'About', href: 'https://ibo.io/about' },
  ],
  Support: [
    { label: SUPPORT_EMAIL, href: `mailto:${SUPPORT_EMAIL}`, isMailto: true },
    { label: 'Help Center', to: '/support' },
    { label: 'Raise a Ticket', to: '/account/support' },
    { label: 'API Docs', href: '#' },
  ],
  Legal: [
    { label: 'Privacy Policy', to: SITE_CONFIG.privacyPolicyPath },
    { label: 'Terms of Service', to: SITE_CONFIG.termsPath },
  ],
};

function FacebookIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function InstagramIcon({ size = 15 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

const SOCIAL = [
  { icon: ExternalLink, href: 'https://x.com/iboofficial', label: 'Twitter' },
  { icon: Send, href: 'https://t.me/iboofficial', label: 'Telegram' },
  { icon: FacebookIcon, href: 'https://www.facebook.com/profile.php?id=61590368919405', label: 'Facebook' },
  { icon: InstagramIcon, href: 'https://www.instagram.com/theibo/', label: 'Instagram' },
  { icon: Mail, href: `mailto:${SUPPORT_EMAIL}`, label: 'Email', isMailto: true },
];

export default function Footer() {
  return (
    <footer
      className="ibo-footer relative z-20 mt-auto shrink-0 overflow-hidden border-t border-white/[0.06]"
      style={{ background: 'var(--ibo-bg)' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 50% 60% at 0% 0%, var(--ibo-bloom-cyan) 0%, transparent 55%), radial-gradient(ellipse 40% 50% at 100% 100%, var(--ibo-bloom-lime) 0%, transparent 50%)',
        }}
      />

      <div className="relative ibo-landing-container py-14 sm:py-16 lg:py-20">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-10 lg:gap-8">
          {/* Brand */}
          <div className="col-span-2 sm:col-span-3 lg:col-span-2">
            <Link to="/" className="inline-flex items-center mb-5">
              <BrandLogo
                alt="Exchange"
                className="h-11 sm:h-12 w-auto max-w-[220px]"
              />
            </Link>
            <p className="text-[14px] sm:text-[15px] text-zinc-400 leading-relaxed max-w-sm mb-6">
              Made for India. Trade crypto futures &amp; options 24/7 with efficient margining, Instant KYC,
              and INR deposit &amp; withdrawal — best-in-class pro features for everyone.
            </p>

            <div className="inline-flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-emerald-400/90 mb-6">
              <span className="relative flex h-1.5 w-1.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-40" />
                <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-emerald-400" />
              </span>
              All systems operational
            </div>

            <div className="flex items-center gap-2.5 mb-6">
              {SOCIAL.map((s) => (
                <a
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  {...(s.isMailto ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                  className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:text-[#00A876] hover:border-[#FE6C02]/40 hover:bg-[#FE6C02]/10 transition-colors"
                >
                  <s.icon size={15} />
                </a>
              ))}
            </div>

            <DunsRegisteredSeal />
          </div>

          {/* Link columns */}
          {Object.entries(LINKS).map(([col, items]) => (
            <div key={col} className="min-w-0">
              <h4 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#FE6C02] mb-4">
                {col}
              </h4>
              <ul className="space-y-3">
                {items.map((item) => (
                  <li key={item.label}>
                    {item.to ? (
                      <Link
                        to={item.to}
                        className="text-[14px] text-zinc-400 hover:text-white transition-colors break-words"
                      >
                        {item.label}
                      </Link>
                    ) : (
                      <a
                        href={item.href}
                        {...(item.isMailto ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                        className="text-[14px] text-zinc-400 hover:text-white transition-colors break-words"
                      >
                        {item.label}
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-12 sm:mt-14 pt-6 border-t border-white/[0.06] flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
          <p className="text-[13px] text-zinc-500">© 2026 Delta Exchange. All rights reserved.</p>

          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-[13px] text-zinc-500">
            <a
              href={`mailto:${SUPPORT_EMAIL}`}
              className="hover:text-[#00A876] transition-colors"
            >
              {SUPPORT_EMAIL}
            </a>
            <Link to={SITE_CONFIG.privacyPolicyPath} className="hover:text-white transition-colors">
              Privacy
            </Link>
            <Link to={SITE_CONFIG.termsPath} className="hover:text-white transition-colors">
              Terms
            </Link>
            <span className="inline-flex items-center gap-1.5 text-zinc-400">
              <Shield size={12} className="text-[#FE6C02]" /> Secured
            </span>
            <span className="inline-flex items-center gap-1.5 text-zinc-400">
              <Zap size={12} className="text-[#00A876]" /> Fast execution
            </span>
          </div>
        </div>

        <p className="mt-4 text-[12px] text-zinc-600 max-w-3xl">
          Trading cryptocurrencies and derivatives involves risk, including possible loss of capital.
          Past performance is not indicative of future results.
        </p>
      </div>
    </footer>
  );
}
