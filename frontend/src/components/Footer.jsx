import { motion } from 'framer-motion';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { Send, Mail, ExternalLink } from 'lucide-react';
import {
  SITE_CONFIG,
  SUPPORT_MAILTO,
  getExchangeStatusLabel,
} from '@/config/site';
import { resolveBrandLogoUrl } from '@/lib/brandAssets';
import { useExchangeDevNotice } from '@/components/ExchangeDevNotice';

const LOGO_URL = resolveBrandLogoUrl(SITE_CONFIG.brandLogoUrl);

const exchangeFooterLink = { name: 'Exchange', href: '#exchange-dev', isExchangeNotice: true };

function FacebookIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
    </svg>
  );
}

function InstagramIcon({ size = 20 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />
      <circle cx="12" cy="12" r="4" />
      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  );
}

const socialLinks = [
  { name: 'Telegram',  icon: Send,          href: SITE_CONFIG.community.telegram,  color: 'hover:text-blue-400' },
  { name: 'Facebook',  icon: FacebookIcon,  href: SITE_CONFIG.community.facebook,  color: 'hover:text-blue-500' },
  { name: 'Instagram', icon: InstagramIcon, href: SITE_CONFIG.community.instagram, color: 'hover:text-pink-400' },
  { name: 'Email',     icon: Mail,          href: SUPPORT_MAILTO,                  color: 'hover:text-ink-accent', isMailto: true },
].filter((link) => link.href);

const footerLinks = {
  Product: [
    { name: 'About',      href: '/about',       isPage: true  },
    { name: 'Utility',    href: '#utility',     isPage: false },
    exchangeFooterLink,
    { name: 'Roadmap',    href: '#roadmap',     isPage: false },
  ],
  Resources: [
    { name: 'Whitepaper', href: SITE_CONFIG.whitepaperPath, isPage: true },
    { name: 'Tokenomics', href: '#tokenomics', isPage: false },
    { name: 'How to Buy', href: '#how-to-buy', isPage: false },
    { name: 'FAQ', href: '#faq', isPage: false },
  ],
  Legal: [
    { name: 'Privacy Policy', href: SITE_CONFIG.privacyPolicyPath, isPage: true },
    { name: 'Terms of Service', href: SITE_CONFIG.termsPath, isPage: true },
  ],
  Support: [
    { name: 'support@ibo.io', href: SUPPORT_MAILTO, isMailto: true },
  ],
};

export const Footer = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotice } = useExchangeDevNotice();

  const scrollToSection = (href) => {
    if (!href.startsWith('#')) return;
    const id = href.slice(1);
    if (location.pathname !== '/') {
      navigate('/');
      setTimeout(() => {
        document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
      }, 120);
      return;
    }
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
  };

  return (
    <footer className="relative overflow-x-hidden bg-surface border-t border-[#0EA4AB]/20" data-testid="footer">
      <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-[min(800px,100vw)] h-[400px] bg-[#0EA4AB]/5 rounded-full blur-3xl" />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 xl:px-16 py-12 sm:py-16 relative z-10">
        <div className="grid grid-cols-2 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-8 sm:gap-10 lg:gap-12 mb-12">
          <div className="col-span-2 lg:col-span-2">
            <motion.a
              href="#hero"
              onClick={(e) => { e.preventDefault(); scrollToSection('#hero'); }}
              className="flex items-center gap-3 mb-6 group"
              whileHover={{ scale: 1.02 }}
            >
              <img src={LOGO_URL} alt="IBO Logo" className="h-12 w-12 object-contain" />
              <span className="text-2xl font-bold">
                <span className="text-ink">IBO</span>
              </span>
            </motion.a>

            <p className="text-ink-muted text-sm leading-relaxed mb-6 max-w-sm">
              {SITE_CONFIG.shortDescription}
            </p>

            <div className="space-y-3 mb-5">
              <p className="text-ink-muted text-sm leading-relaxed max-w-sm">
                <span className="text-ink font-semibold">Project contact</span>
                {' — '}
                <a
                  href={SUPPORT_MAILTO}
                  className="text-ink-accent font-medium underline-offset-2 hover:underline break-all"
                  data-testid="footer-support-email"
                >
                  {SITE_CONFIG.supportEmail}
                </a>
              </p>
              <p className="text-ink-muted text-xs leading-relaxed max-w-sm">
                Official project contact email for support and listing communications.
              </p>
              <p className="inline-flex items-center rounded-xl border border-[#0EA4AB]/30 bg-[#0EA4AB]/8 px-3 py-2 text-xs font-semibold text-ink-accent">
                Exchange status: {getExchangeStatusLabel()}
              </p>
            </div>

            <div className="flex items-center gap-4">
              {socialLinks.map((social) => (
                <motion.a
                  key={social.name}
                  href={social.href}
                  {...(social.isMailto ? {} : { target: '_blank', rel: 'noopener noreferrer' })}
                  className={`w-10 h-10 rounded-xl bg-surface flex items-center justify-center text-ink-muted ${social.color} transition-colors`}
                  whileHover={{ y: -2 }}
                  data-testid={`footer-social-${social.name.toLowerCase()}`}
                >
                  <social.icon size={20} />
                </motion.a>
              ))}
            </div>
          </div>

          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category} className="min-w-0">
              <h4 className="text-ink font-semibold mb-4">{category}</h4>
              <ul className="space-y-3">
                {links.map((link) => {
                  const isHash = link.href.startsWith('#');
                  const isPage = link.isPage || (link.href.startsWith('/') && !link.isExternal);
                  const isMailto = link.href.startsWith('mailto:');
                  const isExternal = Boolean(link.isExternal);
                  const cls = 'text-ink-muted hover:text-ink-accent text-sm transition-colors inline-flex items-center gap-1 break-words';

                  if (link.isExchangeNotice) {
                    return (
                      <li key={link.name}>
                        <button type="button" onClick={showNotice} className={cls}>
                          {link.name}
                        </button>
                      </li>
                    );
                  }

                  if (isHash) {
                    return (
                      <li key={link.name}>
                        <a
                          href={link.href}
                          onClick={(e) => { e.preventDefault(); scrollToSection(link.href); }}
                          className={cls}
                        >
                          {link.name}
                        </a>
                      </li>
                    );
                  }

                  if (isPage) {
                    return (
                      <li key={link.name}>
                        <Link to={link.href} className={cls}>{link.name}</Link>
                      </li>
                    );
                  }

                  return (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        target={isMailto || !isExternal ? undefined : '_blank'}
                        rel={isExternal ? 'noopener noreferrer' : undefined}
                        className={cls}
                      >
                        {link.name}
                        {isExternal && !isMailto && <ExternalLink size={12} className="flex-shrink-0" />}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <div className="glass rounded-xl p-4 mb-8">
          <div className="min-w-0 w-full">
            <p className="text-ink-muted text-sm">Contract Address</p>
            <code className="text-ink-accent text-xs sm:text-sm font-mono break-all">
              {SITE_CONFIG.contractAddress}
            </code>
          </div>
        </div>

        <div className="border-t border-[#4A4B50]/20 pt-8 mb-8">
          <p className="text-ink-muted text-xs leading-relaxed">
            <strong className="text-ink">Disclaimer:</strong> Cryptocurrency investments carry risk. This website is for informational purposes only and does not constitute financial, legal, or investment advice. Always verify official links, contract addresses, and public project information before taking action.
          </p>
        </div>

        <div className="flex flex-col md:flex-row items-center justify-between gap-4 text-ink-muted text-sm">
          <p>&copy; {new Date().getFullYear()} IBO. All rights reserved.</p>
          <div className="flex flex-wrap items-center justify-center md:justify-end gap-x-6 gap-y-2">
            <a
              href={SUPPORT_MAILTO}
              className="hover:text-ink-accent transition-colors"
              data-testid="footer-bottom-support-email"
            >
              support@ibo.io
            </a>
            <Link to={SITE_CONFIG.privacyPolicyPath} className="hover:text-ink-accent transition-colors">Privacy Policy</Link>
            <Link to={SITE_CONFIG.termsPath} className="hover:text-ink-accent transition-colors">Terms of Service</Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
