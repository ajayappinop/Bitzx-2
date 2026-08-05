import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MessageCircle,
  Ticket,
  Mail,
  ChevronRight,
  ChevronDown,
  Search,
  Wallet,
  ShieldCheck,
  Landmark,
  LineChart,
  UserRound,
  BookOpen,
  Clock3,
  Headphones,
} from 'lucide-react';
import { SITE_CONFIG, SUPPORT_MAILTO } from '@/lib/siteConfig';
import { useAuth } from '@/context/AuthContext';

const CONTACT_CHANNELS = [
  {
    key: 'chat',
    icon: MessageCircle,
    title: 'Chat with us',
    desc: 'Feel free to reach out if you face any issue — our team is available 24×7.',
    meta: 'Average reply: under 15 min',
    cta: 'Email support',
    href: SUPPORT_MAILTO,
    external: true,
    tone: 'green',
  },
  {
    key: 'ticket',
    icon: Ticket,
    title: 'Support ticket',
    desc: 'Get help by raising a support ticket. Our team will respond within 12 hours.',
    meta: 'Best for KYC, deposits & account issues',
    cta: 'Raise a ticket',
    to: '/account/support',
    tone: 'orange',
  },
];

const TOPICS = [
  {
    icon: Landmark,
    title: 'KYC & verification',
    desc: 'Aadhaar, PAN, face match, and Instant KYC status.',
    href: '/account/kyc',
  },
  {
    icon: Wallet,
    title: 'Deposits & withdrawals',
    desc: 'INR rails, bank details, crypto deposits, and payouts.',
    href: '/account/deposits',
  },
  {
    icon: LineChart,
    title: 'Trading & orders',
    desc: 'Futures, options, spot, order history, and positions.',
    href: '/markets',
  },
  {
    icon: ShieldCheck,
    title: 'Security & 2FA',
    desc: 'Password, authenticator app, sessions, and account access.',
    href: '/account/security',
  },
  {
    icon: UserRound,
    title: 'Account & profile',
    desc: 'Profile details, preferences, and linked payout methods.',
    href: '/account/profile',
  },
  {
    icon: BookOpen,
    title: 'Fees & policies',
    desc: 'Platform terms, privacy, and product guidelines.',
    href: '/terms-of-service',
  },
];

const FAQS = [
  {
    q: 'How do I contact Delta support?',
    a: `Email ${SITE_CONFIG.supportEmail} anytime for 24×7 help, or raise a support ticket from your account for tracked cases (typical response within 12 hours).`,
  },
  {
    q: 'How long does ticket support take?',
    a: 'Most tickets are reviewed within 12 hours. Priority cases related to open P2P disputes, stuck deposits, or locked account access may be escalated sooner.',
  },
  {
    q: 'What should I include in a support ticket?',
    a: 'Share your registered email or UID, a short summary, exact error text if any, timestamps (with timezone), asset/network, and screenshots of transfer receipts or order IDs.',
  },
  {
    q: 'Can I get help with KYC or INR deposits?',
    a: 'Yes. Our team assists with Instant KYC issues, bank/UPI verification, and INR deposit or withdrawal status. Complete KYC and bank details first when prompted in-app.',
  },
  {
    q: 'I lost access to my 2FA authenticator. What now?',
    a: `If you still have backup codes, use them at login. If not, contact ${SITE_CONFIG.supportEmail} from your registered email — never share passwords or seed phrases with anyone claiming to be support.`,
  },
];

function toneStyles(tone) {
  if (tone === 'green') {
    return {
      icon: 'text-[#00A876] bg-[rgba(0,168,118,0.12)] border-[rgba(0,168,118,0.32)]',
      ring: 'hover:border-[rgba(0,168,118,0.45)]',
      accent: 'text-[#00A876]',
      bar: 'from-[#00A876]/50 via-[#00A876]/20 to-transparent',
    };
  }
  return {
    icon: 'text-[#FE6C02] bg-[rgba(254,108,2,0.12)] border-[rgba(254,108,2,0.32)]',
    ring: 'hover:border-[rgba(254,108,2,0.45)]',
    accent: 'text-[#FE6C02]',
    bar: 'from-[#FE6C02]/50 via-[#FE6C02]/20 to-transparent',
  };
}

function FaqItem({ item, open, onToggle }) {
  return (
    <div
      className="rounded-2xl border border-[color:var(--ibo-border-solid)] overflow-hidden"
      style={{ background: 'var(--ibo-bg)' }}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="w-full flex items-center gap-4 px-5 sm:px-6 py-4 sm:py-5 text-left hover:bg-[color:var(--ibo-hover)] transition-colors"
      >
        <span className="flex-1 font-semibold text-[15px] sm:text-[16px] text-[color:var(--ibo-ink)] tracking-tight leading-snug">
          {item.q}
        </span>
        <ChevronDown
          size={18}
          className={`shrink-0 text-[color:var(--ibo-muted)] transition-transform duration-200 ${open ? 'rotate-180 text-[#FE6C02]' : ''}`}
        />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            className="overflow-hidden"
          >
            <p className="px-5 sm:px-6 pb-5 pt-0 text-[14px] leading-relaxed text-[color:var(--ibo-muted)] border-t border-[color:var(--ibo-border-solid)]">
              <span className="block pt-4">{item.a}</span>
            </p>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default function SupportCenterPage() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [openFaq, setOpenFaq] = useState(0);

  const filteredFaqs = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return FAQS;
    return FAQS.filter(
      (f) => f.q.toLowerCase().includes(q) || f.a.toLowerCase().includes(q),
    );
  }, [query]);

  const ticketDest = user ? '/account/support' : '/login';

  return (
    <div className="ibo-page relative overflow-hidden text-[color:var(--ibo-ink)]">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse 55% 42% at 50% -5%, rgba(254,108,2,0.14) 0%, transparent 55%), radial-gradient(ellipse 40% 40% at 100% 30%, rgba(0,168,118,0.08) 0%, transparent 50%), radial-gradient(ellipse 35% 35% at 0% 70%, rgba(254,108,2,0.06) 0%, transparent 50%)',
        }}
      />

      <div className="relative ibo-landing-container pt-10 sm:pt-14 pb-16 sm:pb-24">
        {/* Hero */}
        <motion.header
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
          className="max-w-3xl mx-auto text-center mb-10 sm:mb-14"
        >
          <p className="ibo-eyebrow mb-3 text-center">Help Center</p>
          <h1 className="ibo-display text-[2rem] sm:text-[2.75rem] lg:text-[3.15rem] font-bold tracking-tight leading-[1.1] mb-4">
            {SITE_CONFIG.projectName}{' '}
            <span className="text-[#FE6C02]">Help Center</span>
          </h1>
          <p className="text-[15px] sm:text-[16px] text-[color:var(--ibo-muted)] leading-relaxed max-w-xl mx-auto">
            Get answers fast — chat with the team, open a ticket, or browse common topics for
            KYC, deposits, trading, and security.
          </p>

          <div className="mt-7 max-w-xl mx-auto relative">
            <Search
              size={17}
              className="absolute left-4 top-1/2 -translate-y-1/2 text-[color:var(--ibo-muted)] pointer-events-none"
            />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search help topics…"
              className="w-full rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] pl-11 pr-4 py-3.5 text-sm text-[color:var(--ibo-ink)] outline-none placeholder:text-[color:var(--ibo-muted)] focus:border-[rgba(254,108,2,0.45)] transition-colors shadow-sm"
              aria-label="Search help topics"
            />
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-center gap-x-5 gap-y-2 text-[12px] text-[color:var(--ibo-muted)]">
            <span className="inline-flex items-center gap-1.5">
              <Headphones size={13} className="text-[#00A876]" /> 24×7 availability
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Clock3 size={13} className="text-[#FE6C02]" /> Tickets within 12 hours
            </span>
            <a
              href={SUPPORT_MAILTO}
              className="inline-flex items-center gap-1.5 hover:text-[#FE6C02] transition-colors"
            >
              <Mail size={13} /> {SITE_CONFIG.supportEmail}
            </a>
          </div>
        </motion.header>

        {/* Primary contact cards — matches Delta Help Center pattern */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5 max-w-4xl mx-auto mb-14 sm:mb-16">
          {CONTACT_CHANNELS.map((ch, i) => {
            const Icon = ch.icon;
            const styles = toneStyles(ch.tone);
            const isTicket = ch.key === 'ticket';
            const body = (
              <>
                <div
                  aria-hidden
                  className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${styles.bar}`}
                />
                <div
                  className={`mb-5 flex h-12 w-12 items-center justify-center rounded-xl border ${styles.icon}`}
                >
                  <Icon size={22} />
                </div>
                <h2 className="text-[1.25rem] sm:text-[1.35rem] font-bold tracking-tight text-[color:var(--ibo-ink)] mb-2">
                  {ch.title}
                </h2>
                <p className="text-[14px] leading-relaxed text-[color:var(--ibo-muted)] mb-4 flex-1">
                  {ch.desc}
                </p>
                <p className={`text-[12px] font-semibold mb-5 ${styles.accent}`}>{ch.meta}</p>
                <span
                  className={`inline-flex items-center gap-1.5 text-[13px] font-bold ${styles.accent} group-hover:gap-2.5 transition-all`}
                >
                  {ch.cta}
                  <ChevronRight size={15} />
                </span>
              </>
            );

            const cardClass = `group relative flex flex-col h-full rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] p-6 sm:p-8 transition-all duration-200 shadow-sm hover:shadow-md ${styles.ring}`;

            return (
              <motion.div
                key={ch.key}
                initial={{ opacity: 0, y: 18 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.08 + i * 0.06, ease: [0.16, 1, 0.3, 1] }}
              >
                {isTicket ? (
                  <Link to={ticketDest} className={cardClass}>
                    {body}
                  </Link>
                ) : (
                  <a href={ch.href} className={cardClass}>
                    {body}
                  </a>
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Browse topics */}
        <section className="max-w-5xl mx-auto mb-14 sm:mb-16">
          <div className="flex items-end justify-between gap-4 mb-5 sm:mb-6">
            <div>
              <p className="ibo-eyebrow mb-2">Browse</p>
              <h2 className="text-[1.35rem] sm:text-[1.55rem] font-bold tracking-tight text-[color:var(--ibo-ink)]">
                Popular help topics
              </h2>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 sm:gap-4">
            {TOPICS.map((topic, i) => {
              const Icon = topic.icon;
              return (
                <motion.div
                  key={topic.title}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: '-40px' }}
                  transition={{ duration: 0.35, delay: i * 0.03 }}
                >
                  <Link
                    to={user || topic.href.startsWith('/markets') || topic.href.startsWith('/terms')
                      ? topic.href
                      : '/login'}
                    className="group flex items-start gap-3.5 h-full rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-bg)] px-4 py-4 sm:px-5 sm:py-5 hover:border-[rgba(254,108,2,0.4)] transition-colors"
                  >
                    <span className="shrink-0 w-10 h-10 rounded-xl grid place-items-center border border-[rgba(254,108,2,0.28)] bg-[rgba(254,108,2,0.1)] text-[#FE6C02]">
                      <Icon size={18} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[14px] font-bold text-[color:var(--ibo-ink)]">
                          {topic.title}
                        </span>
                        <ChevronRight
                          size={15}
                          className="shrink-0 text-[color:var(--ibo-muted)] group-hover:text-[#FE6C02] transition-colors"
                        />
                      </span>
                      <span className="mt-1 block text-[12.5px] leading-relaxed text-[color:var(--ibo-muted)]">
                        {topic.desc}
                      </span>
                    </span>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </section>

        {/* FAQ */}
        <section className="max-w-3xl mx-auto mb-14 sm:mb-16">
          <div className="text-center mb-6 sm:mb-8">
            <p className="ibo-eyebrow mb-2 text-center">FAQ</p>
            <h2 className="text-[1.35rem] sm:text-[1.55rem] font-bold tracking-tight text-[color:var(--ibo-ink)]">
              Frequently asked questions
            </h2>
          </div>

          <div className="space-y-3">
            {filteredFaqs.length === 0 ? (
              <div className="rounded-2xl border border-[color:var(--ibo-border-solid)] px-5 py-8 text-center text-sm text-[color:var(--ibo-muted)]">
                No matching articles. Try another search or{' '}
                <a href={SUPPORT_MAILTO} className="text-[#FE6C02] font-semibold hover:underline">
                  email support
                </a>
                .
              </div>
            ) : (
              filteredFaqs.map((item, idx) => (
                <FaqItem
                  key={item.q}
                  item={item}
                  open={openFaq === idx}
                  onToggle={() => setOpenFaq((v) => (v === idx ? -1 : idx))}
                />
              ))
            )}
          </div>
        </section>

        {/* Bottom CTA strip */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          className="max-w-4xl mx-auto rounded-2xl border border-[rgba(254,108,2,0.3)] overflow-hidden"
          style={{
            background:
              'linear-gradient(135deg, rgba(254,108,2,0.12) 0%, transparent 52%, rgba(0,168,118,0.08) 100%)',
          }}
        >
          <div className="px-6 sm:px-10 py-8 sm:py-10 flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-8">
            <div className="flex-1 min-w-0">
              <h3 className="text-[1.15rem] sm:text-[1.3rem] font-bold text-[color:var(--ibo-ink)] mb-1.5">
                Still need help?
              </h3>
              <p className="text-[14px] text-[color:var(--ibo-muted)] leading-relaxed">
                Write to{' '}
                <a href={SUPPORT_MAILTO} className="font-semibold text-[#FE6C02] hover:underline">
                  {SITE_CONFIG.supportEmail}
                </a>{' '}
                or open a ticket from your account dashboard.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5 shrink-0">
              <a
                href={SUPPORT_MAILTO}
                className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold border border-[color:var(--ibo-border-solid)] text-[color:var(--ibo-ink)] hover:border-[rgba(254,108,2,0.4)] transition-colors"
              >
                <Mail size={15} /> Email us
              </a>
              <Link
                to={ticketDest}
                className="inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-bold bg-[#FE6C02] text-white hover:bg-[#ff7a1a] transition-colors"
              >
                <Ticket size={15} /> Open ticket
              </Link>
            </div>
          </div>
        </motion.section>
      </div>
    </div>
  );
}
