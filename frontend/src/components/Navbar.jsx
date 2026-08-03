import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Menu, X, ChevronRight } from 'lucide-react';
import { useNavigate, useLocation } from 'react-router-dom';
import { SITE_CONFIG } from '@/config/site';
import { resolveBrandLogoUrl, BRAND_LOGO } from '@/lib/brandAssets';
import { useExchangeDevNotice } from '@/components/ExchangeDevNotice';

const LOGO_URL = resolveBrandLogoUrl(SITE_CONFIG.brandLogoUrl);

const NAV_LINKS = [
  { name: 'About', href: '/about', isPage: true },
  { name: 'Transparency', href: '/about#transparency', isPage: true },
  { name: 'Utility', href: '#utility', isPage: false },
  { name: 'Exchange', href: '#exchange', isPage: false },
  { name: 'KYC', href: '#instant-kyc', isPage: false },
  { name: 'Roadmap', href: '#roadmap', isPage: false },
  { name: 'Tokenomics', href: '#tokenomics', isPage: false },
  { name: 'Whitepaper', href: '/whitepaper', isPage: true },
  { name: 'FAQ', href: '#faq', isPage: false },
];

function pagePath(href) {
  return href.split('#')[0] || '/';
}

export const Navbar = () => {
  const [scrolled, setScrolled] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { showNotice, showBuyNotice } = useExchangeDevNotice();

  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname, location.hash]);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 40);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  /* Lock body scroll while mobile drawer is open */
  useEffect(() => {
    if (!menuOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [menuOpen]);

  const scrollToHash = (hash) => {
    if (!hash) return;
    const id = hash.startsWith('#') ? hash.slice(1) : hash;
    requestAnimationFrame(() => {
      document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' });
    });
  };

  const handleLink = (link) => {
    setMenuOpen(false);
    if (link.isPage) {
      const [path, hash] = link.href.split('#');
      navigate(link.href);
      if (hash) {
        setTimeout(() => scrollToHash(hash), 120);
      }
      return;
    }
    if (location.pathname !== '/') {
      navigate('/');
      setTimeout(() => scrollToHash(link.href), 120);
    } else {
      scrollToHash(link.href);
    }
  };

  const isActive = (link) => {
    if (link.isPage) return location.pathname === pagePath(link.href);
    return false;
  };

  return (
    <motion.header
      data-testid="navbar"
      initial={{ y: -120 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="fixed top-0 left-0 right-0 z-50"
    >
      <div
        className={`transition-all duration-300 ${
          scrolled || menuOpen
            ? 'bg-surface/90 backdrop-blur-xl border-b border-line py-3'
            : 'bg-transparent border-b border-transparent py-4'
        }`}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 xl:px-16 flex items-center gap-3 sm:gap-4">
          <motion.a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              setMenuOpen(false);
              if (location.pathname !== '/') navigate('/');
              else window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="flex items-center gap-2.5 flex-shrink-0 group min-w-0"
            whileHover={{ scale: 1.02 }}
            data-testid="navbar-logo"
          >
            <img
              src={LOGO_URL}
              alt="Exchange"
              className="h-8 sm:h-9 w-auto max-w-[180px] object-contain transition-transform group-hover:scale-105"
              onError={(e) => {
                if (e.currentTarget.src.includes('ibo-exchange-logo')) return;
                e.currentTarget.onerror = null;
                e.currentTarget.src = BRAND_LOGO;
              }}
            />
          </motion.a>

          {/* Desktop links — xl+ so mid-widths stay uncrowded */}
          <nav className="hidden xl:flex items-center gap-0.5 ml-2 2xl:ml-4">
            {NAV_LINKS.map((link) => (
              <motion.button
                key={link.name}
                onClick={() => handleLink(link)}
                className={`px-2.5 2xl:px-3.5 py-2 rounded-lg text-sm font-medium transition-all whitespace-nowrap ${
                  isActive(link)
                    ? 'text-ink-accent bg-[#0EA4AB]/10'
                    : 'text-ink-soft hover:text-ink-accent hover:bg-[#0EA4AB]/8'
                }`}
                whileHover={{ y: -1 }}
                data-testid={`nav-link-${link.name.toLowerCase()}`}
              >
                {link.name}
              </motion.button>
            ))}
          </nav>

          <div className="flex-1" />

          <div className="flex items-center gap-2 sm:gap-3 flex-shrink-0">
            <motion.button
              type="button"
              onClick={showNotice}
              className="hidden sm:flex items-center text-xs sm:text-sm font-bold px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl border-2 border-[#0EA4AB]/30 text-ink-accent bg-[#0EA4AB]/8 whitespace-nowrap"
              whileHover={{ scale: 1.04, borderColor: 'rgba(197,227,91,0.5)' }}
              whileTap={{ scale: 0.97 }}
              data-testid="navbar-exchange-btn"
            >
              Trade
            </motion.button>
            <motion.button
              type="button"
              onClick={showBuyNotice}
              className="flex items-center text-xs sm:text-sm font-bold px-3 sm:px-5 py-2 sm:py-2.5 rounded-xl bg-logo-gradient text-[#050a1a] shadow-[0_0_20px_rgba(14,164,171,0.3)] whitespace-nowrap"
              whileHover={{ scale: 1.04, boxShadow: '0 0 28px rgba(14,164,171,0.5)' }}
              whileTap={{ scale: 0.97 }}
              data-testid="navbar-buy-btn"
            >
              Buy $DELTA
            </motion.button>

            <button
              onClick={() => setMenuOpen((v) => !v)}
              className="xl:hidden flex items-center justify-center w-9 h-9 rounded-lg text-ink-soft hover:text-ink hover:bg-[#0EA4AB]/10 transition-colors"
              aria-label={menuOpen ? 'Close menu' : 'Open menu'}
              aria-expanded={menuOpen}
              data-testid="mobile-menu-btn"
            >
              <AnimatePresence mode="wait" initial={false}>
                {menuOpen ? (
                  <motion.span
                    key="x"
                    initial={{ rotate: -90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: 90, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <X size={20} />
                  </motion.span>
                ) : (
                  <motion.span
                    key="menu"
                    initial={{ rotate: 90, opacity: 0 }}
                    animate={{ rotate: 0, opacity: 1 }}
                    exit={{ rotate: -90, opacity: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <Menu size={20} />
                  </motion.span>
                )}
              </AnimatePresence>
            </button>
          </div>
        </div>
      </div>

      <AnimatePresence>
        {menuOpen && (
          <>
            <motion.button
              type="button"
              aria-label="Close menu"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="xl:hidden fixed inset-0 top-[64px] z-40 bg-black/40 backdrop-blur-[2px]"
              onClick={() => setMenuOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2 }}
              className="xl:hidden relative z-50 bg-surface-card border-b border-line shadow-[0_12px_32px_rgba(0,0,0,0.45)] max-h-[min(75vh,calc(100dvh-4rem))] overflow-y-auto"
              data-testid="mobile-menu"
            >
              <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-1 mb-4">
                  {NAV_LINKS.map((link) => (
                    <button
                      key={link.name}
                      onClick={() => handleLink(link)}
                      className={`flex items-center gap-2 px-3 py-2.5 rounded-xl text-sm font-medium transition-all text-left ${
                        isActive(link)
                          ? 'text-[#0EA4AB] bg-[#0EA4AB]/10'
                          : 'text-ink-soft hover:text-[#0EA4AB] hover:bg-[#0EA4AB]/8'
                      }`}
                    >
                      <ChevronRight size={14} className="text-[#0EA4AB] flex-shrink-0" />
                      {link.name}
                    </button>
                  ))}
                </div>

                <button
                  type="button"
                  onClick={() => {
                    setMenuOpen(false);
                    showNotice();
                  }}
                  className="sm:hidden flex w-full items-center justify-center gap-2 rounded-xl border-2 border-[#0EA4AB]/30 bg-[#0EA4AB]/8 px-4 py-3 text-sm font-bold text-[#0EA4AB]"
                  data-testid="mobile-menu-trade-btn"
                >
                  Trade on Exchange
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </motion.header>
  );
};

export default Navbar;
