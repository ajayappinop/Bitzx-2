import { useState } from 'react';

import { Link } from 'react-router-dom';

import { motion, AnimatePresence } from 'framer-motion';

import { ChevronDown, ExternalLink, Send, Mail } from 'lucide-react';

import { SITE_CONFIG, SUPPORT_MAILTO } from '@/lib/siteConfig';



const FAQS = [
  {
    q: 'Is Delta Exchange available in India?',
    a: 'Yes. Delta is built for India with Instant KYC (Aadhaar, PAN, face match), INR deposit and withdrawal flows, and full trading on futures and options.',
  },
  {
    q: 'Do I need to hold crypto to trade?',
    a: 'No. You can deposit INR, use it as trading capital/margin, and trade futures and options without owning the underlying crypto. Withdraw profits back in INR to your bank or UPI.',
  },
  {
    q: 'What can I trade on Delta?',
    a: 'Trade Bitcoin and Ether futures & options, and perpetual markets — with deep books, pro charts, and portfolio P&L in one place. Markets stay open 24/7.',
  },
  {
    q: 'How do INR deposits and withdrawals work?',
    a: 'Link your bank or UPI, deposit INR via supported rails, complete Instant KYC if required, then trade. When you cash out, withdraw INR to your verified payout profile from Wallet.',
  },
  {
    q: 'How secure is my account?',
    a: 'Delta uses multi-factor security, cold-wallet custody practices for assets in custody, withdrawal controls, and continuous monitoring — plus FIU-aligned compliance for Indian users.',
  },
  {
    q: 'How do I contact support?',
    a: `Email ${SITE_CONFIG.supportEmail} anytime, or raise a support ticket from your account. Our team helps with KYC, INR transfers, and trading questions.`,
  },
];



function FacebookIcon({ size = 14 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden>

      <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />

    </svg>

  );

}



function InstagramIcon({ size = 14 }) {

  return (

    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>

      <rect x="2" y="2" width="20" height="20" rx="5" ry="5" />

      <circle cx="12" cy="12" r="4" />

      <circle cx="17.5" cy="6.5" r="0.5" fill="currentColor" stroke="none" />

    </svg>

  );

}



const SOCIAL = [

  { label: 'Twitter', href: 'https://x.com/iboofficial', icon: ExternalLink },

  { label: 'Telegram', href: 'https://t.me/iboofficial', icon: Send },

  { label: 'Instagram', href: 'https://www.instagram.com/theibo/', icon: InstagramIcon },

  { label: 'Facebook', href: 'https://www.facebook.com/profile.php?id=61590368919405', icon: FacebookIcon },

  { label: 'Email', href: SUPPORT_MAILTO, icon: Mail, isMailto: true },

];



function FaqItem({ item, open, onToggle }) {

  return (

    <div

      className="rounded-2xl border border-white/[0.08] overflow-hidden"

      style={{ background: 'var(--ibo-elevated)' }}

    >

      <button

        type="button"

        onClick={onToggle}

        aria-expanded={open}

        className="w-full flex items-center gap-4 px-5 sm:px-6 py-4 sm:py-5 text-left hover:bg-white/[0.02] transition-colors"

      >

        <span className="flex-1 font-display text-[15px] sm:text-[16px] font-semibold text-white tracking-tight leading-snug">

          {item.q}

        </span>

        <span

          className={`shrink-0 grid place-items-center h-9 w-9 rounded-full border transition-colors ${

            open

              ? 'border-[#00A876]/50 bg-[#00A876]/15 text-[#00A876]'

              : 'border-[#FE6C02]/40 bg-[#FE6C02]/10 text-[#FE6C02]'

          }`}

        >

          <ChevronDown

            size={18}

            className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`}

          />

        </span>

      </button>

      <AnimatePresence initial={false}>

        {open ? (

          <motion.div

            key="answer"

            initial={{ height: 0, opacity: 0 }}

            animate={{ height: 'auto', opacity: 1 }}

            exit={{ height: 0, opacity: 0 }}

            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}

            className="overflow-hidden"

          >

            <p className="px-5 sm:px-6 pb-5 sm:pb-6 pt-0 text-[14px] sm:text-[15px] text-zinc-400 leading-relaxed border-t border-white/[0.05]">

              <span className="block pt-4">{item.a}</span>

            </p>

          </motion.div>

        ) : null}

      </AnimatePresence>

    </div>

  );

}



/**

 * Support card + FAQ accordion — landing help section.

 */

export default function LandingFaqSupport() {

  const [openIndex, setOpenIndex] = useState(0);



  return (

    <section

      className="relative overflow-hidden border-t border-white/[0.06]"

      style={{ background: 'var(--ibo-bg)' }}

    >

      <div

        aria-hidden

        className="pointer-events-none absolute inset-0"

        style={{

          background:

            'radial-gradient(ellipse 45% 55% at 15% 30%, rgba(254, 108, 2,0.1) 0%, transparent 55%), radial-gradient(ellipse 40% 50% at 90% 70%, rgba(0, 168, 118,0.06) 0%, transparent 50%)',

        }}

      />



      <div className="relative ibo-landing-container ibo-section-y">

        <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.35fr)] gap-6 lg:gap-8 xl:gap-10 items-stretch">

          {/* Support card */}

          <motion.aside

            initial={{ opacity: 0, y: 20 }}

            whileInView={{ opacity: 1, y: 0 }}

            viewport={{ once: true }}

            transition={{ duration: 0.55, ease: [0.16, 1, 0.3, 1] }}

            className="relative overflow-hidden rounded-[1.25rem] sm:rounded-[1.5rem] border p-5 sm:p-7 lg:p-9 flex flex-col min-h-0 sm:min-h-[300px] lg:min-h-[340px]"

            style={{

              borderColor: 'rgba(254, 108, 2,0.3)',

              background:

                'linear-gradient(155deg, rgba(254, 108, 2,0.16) 0%, color-mix(in srgb, var(--ibo-card) 92%, transparent) 45%, rgba(0, 168, 118,0.1) 100%)',

              boxShadow: '0 18px 48px rgba(254, 108, 2,0.1), var(--ibo-shadow)',

            }}

          >

            <div

              aria-hidden

              className="pointer-events-none absolute inset-x-0 top-0 h-px"

              style={{

                background: 'linear-gradient(90deg, transparent, rgba(254, 108, 2,0.5), rgba(0, 168, 118,0.4), transparent)',

              }}

            />

            <div

              aria-hidden

              className="pointer-events-none absolute -right-16 -bottom-20 h-64 w-64 rounded-full opacity-35"

              style={{

                background:

                  'repeating-radial-gradient(circle at center, transparent 0, transparent 14px, rgba(254, 108, 2,0.14) 14px, rgba(254, 108, 2,0.14) 15px)',

              }}

            />

            <div

              aria-hidden

              className="pointer-events-none absolute inset-0 opacity-60"

              style={{

                background:

                  'radial-gradient(ellipse 55% 45% at 85% 90%, rgba(0, 168, 118,0.16) 0%, transparent 60%), radial-gradient(ellipse 40% 35% at 10% 15%, rgba(254, 108, 2,0.14) 0%, transparent 55%)',

              }}

            />



            <div className="relative flex flex-col flex-1">

              <p className="ibo-eyebrow mb-3">Support</p>

              <h2

                className="font-display text-[1.75rem] sm:text-[2rem] lg:text-[2.15rem] font-bold tracking-tight leading-[1.15] mb-8"

                style={{ color: 'var(--ibo-ink)' }}

              >

                24×7 Customer

                <br />

                Support

              </h2>



              <div className="space-y-6 text-[14px] sm:text-[15px] leading-relaxed" style={{ color: 'var(--ibo-ink-secondary)' }}>

                <div>

                  <p className="font-semibold mb-1" style={{ color: 'var(--ibo-ink)' }}>Have a question?</p>

                  <p>

                    Email{' '}

                    <a

                      href={SUPPORT_MAILTO}

                      className="font-semibold hover:underline underline-offset-2"

                      style={{ color: 'var(--ibo-accent)' }}

                    >

                      {SITE_CONFIG.supportEmail}

                    </a>{' '}

                    for a quick response from our team.

                  </p>

                </div>

                <div>

                  <p className="font-semibold mb-1" style={{ color: 'var(--ibo-ink)' }}>Raise a ticket</p>

                  <p>

                    <Link

                      to="/support"

                      className="font-semibold hover:underline underline-offset-2"

                      style={{ color: 'var(--ibo-accent)' }}

                    >

                      Open the Help Center

                    </Link>{' '}

                    — we are here to help with KYC, deposits, and trades.

                  </p>

                </div>

                <div>

                  <p className="font-semibold mb-3" style={{ color: 'var(--ibo-ink)' }}>Interact with our community</p>

                  <div className="flex flex-wrap items-center gap-2.5">

                    {SOCIAL.map((s) => (

                      <a

                        key={s.label}

                        href={s.href}

                        aria-label={s.label}

                        {...(s.isMailto ? {} : { target: '_blank', rel: 'noopener noreferrer' })}

                        className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#101013] hover:brightness-110 transition-[filter] shadow-[0_8px_24px_rgba(254, 108, 2,0.22)]"

                        style={{

                          background: 'linear-gradient(135deg, #FE6C02 0%, #00A876 100%)',

                        }}

                      >

                        <s.icon size={15} />

                      </a>

                    ))}

                  </div>

                </div>

              </div>

            </div>

          </motion.aside>



          {/* FAQ list */}

          <motion.div

            initial={{ opacity: 0, y: 20 }}

            whileInView={{ opacity: 1, y: 0 }}

            viewport={{ once: true }}

            transition={{ duration: 0.55, delay: 0.08, ease: [0.16, 1, 0.3, 1] }}

            className="min-w-0"

          >

            <h2 className="ibo-title-lg mb-6 sm:mb-8">

              Frequently Asked{' '}

              <span className="text-gradient">Questions</span>

            </h2>



            <div className="space-y-3 sm:space-y-3.5">

              {FAQS.map((item, i) => (

                <FaqItem

                  key={item.q}

                  item={item}

                  open={openIndex === i}

                  onToggle={() => setOpenIndex((prev) => (prev === i ? -1 : i))}

                />

              ))}

            </div>

          </motion.div>

        </div>

      </div>

    </section>

  );

}

