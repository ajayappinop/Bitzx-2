import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from './ui/accordion';
import { SUPPORT_EMAIL, SUPPORT_MAILTO } from '../config/support';
import { SITE_CONFIG, officialSocialChannelLabels, getExchangeStatusLabel, getExchangeUrlDisplay } from '@/config/site';

const EXCHANGE_URL_LABEL = getExchangeUrlDisplay();

const faqs = [
  {
    question: 'What is IBO ($IBO)?',
    answer: 'IBO is a utility token built on BNB Chain (BEP-20). It is presented as the foundation of the IBO ecosystem and is intended to support future platform utility, ecosystem access, and project growth initiatives.',
  },
  {
    question: 'How can I buy $IBO?',
    answer: 'You can buy $IBO on PancakeSwap. Simply connect your wallet (MetaMask or Trust Wallet), ensure you have BNB for the swap and gas fees, then paste the $IBO contract address and swap your BNB for $IBO tokens. Set slippage to 5-10% for best results.',
  },
  {
    question: 'What is the total supply of $IBO?',
    answer: 'The total supply of $IBO is 90,00,00,000 (900 million) tokens. The allocation includes 40% for liquidity, 15% for marketing, 15% for development, 15% for ecosystem rewards, 10% for team/reserve, and 5% for partnerships.',
  },
  {
    question: 'What is IBO Exchange?',
    answer: `IBO Exchange is the project's live centralized trading platform at ${EXCHANGE_URL_LABEL}. Trade IBO and other spot pairs with professional charts, secure wallets, and platform utility for $IBO holders.`,
  },
  {
    question: 'Is IBO Exchange live?',
    answer: `Yes. IBO Exchange is ${getExchangeStatusLabel().toLowerCase()} at ${EXCHANGE_URL_LABEL}. Sign up, complete KYC where required, and start trading through the official site.`,
  },
  {
    question: 'Is $IBO safe? Has it been audited?',
    answer: 'Always verify the official contract address and rely only on published audit or security documents that the project has made public. If audit reports are not yet published on the official website or whitepaper, they should not be assumed.',
  },
  {
    question: 'What benefits do $IBO holders get?',
    answer: 'Holding $IBO provides numerous benefits including: trading fee discounts on IBO Exchange, VIP membership tiers, staking rewards, referral bonuses, early access to launchpad projects, and exclusive ecosystem features.',
  },
  {
    question: 'How can I contact the team?',
    answer: (
      <>
        You can reach us through our official social channels
        {officialSocialChannelLabels().length > 0
          ? ` (${officialSocialChannelLabels().join(', ')})`
          : ''}{' '}
        — links are in the footer.
        For contact and support by email, write to{' '}
        <a
          href={SUPPORT_MAILTO}
          className="text-ink-accent font-medium underline underline-offset-2 hover:text-ink"
          data-testid="faq-support-email"
        >
          {SUPPORT_EMAIL}
        </a>
        {' '}(opens your default email app).
      </>
    ),
  },
];

export const FAQ = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });

  return (
    <section
      id="faq"
      ref={ref}
      className="section-padding relative overflow-hidden"
      data-testid="faq-section"
    >
      {/* Background */}
      <div className="absolute top-0 right-0 w-96 h-96 bg-[#0EA4AB]/5 rounded-full blur-3xl" />

      <div className="max-w-5xl mx-auto relative z-10">
        {/* Section Header */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-12 sm:mb-16"
        >
          <span className="inline-block text-ink-accent text-sm font-semibold tracking-wider uppercase mb-4">
            FAQ
          </span>
          <h2 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold text-ink mb-6">
            Frequently Asked Questions
          </h2>
          <p className="text-ink-soft text-base sm:text-lg md:text-xl max-w-2xl mx-auto leading-relaxed">
            Find answers to common questions about IBO and our ecosystem
          </p>
        </motion.div>

        {/* FAQ Accordion */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.2 }}
        >
          <Accordion type="single" collapsible className="space-y-4">
            {faqs.map((faq, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="card-glass !border !border-[#2ECAD0]/30 px-4 sm:px-6 data-[state=open]:!border-[#2ECAD0]/60 data-[state=open]:shadow-[0_0_24px_rgba(46,202,208,0.15)]"
                data-testid={`faq-item-${index}`}
              >
                <AccordionTrigger className="text-ink hover:text-ink-accent text-left py-5 sm:py-6 hover:no-underline text-sm sm:text-base">
                  {faq.question}
                </AccordionTrigger>
                <AccordionContent className="text-ink-muted pb-6 leading-relaxed text-sm sm:text-base">
                  {faq.answer}
                </AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </motion.div>

        {/* Bottom CTA */}
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mt-12 text-center"
        >
          <p className="text-ink-muted mb-4">
            Still have questions?
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-center gap-3 sm:gap-8">
            <p
              className="text-ink-accent font-medium text-sm sm:text-base px-2"
              data-testid="faq-contact-link"
            >
              Join our Telegram community for support →
            </p>
            <p
              className="text-ink-accent font-medium text-sm sm:text-base px-2 break-all"
              data-testid="faq-email-link"
            >
              Email us at {SUPPORT_EMAIL} →
            </p>
          </div>
        </motion.div>
      </div>
    </section>
  );
};

export default FAQ;
