import { motion, useInView } from 'framer-motion';
import { useRef } from 'react';
import {
  ArrowDownCircle,
  ArrowUpCircle,
  Banknote,
  CheckCircle,
  IndianRupee,
  Shield,
  Clock,
  ArrowRight,
} from 'lucide-react';
import { getExchangeUrlDisplay } from '@/config/site';
import { useExchangeDevNotice } from '@/components/ExchangeDevNotice';

const EXCHANGE_URL_LABEL = getExchangeUrlDisplay();

const depositSteps = [
  'Transfer INR via bank or UPI using our payment details',
  'Submit your UTR and payment proof in the exchange wallet',
  'After admin review, Delta is credited to your spot balance',
];

const withdrawSteps = [
  'Sell Delta from your wallet — balance is reserved instantly',
  'Request an INR payout to your linked bank or UPI',
  'Receive INR after review, with payout reference on record',
];

const highlights = [
  { icon: IndianRupee, label: 'INR-native flows', desc: 'Deposit & withdraw in rupees' },
  { icon: Shield, label: 'Reviewed payouts', desc: 'Manual verification for safety' },
  { icon: Clock, label: 'Track in wallet', desc: 'Full history in one place' },
];

export const InrFiat = () => {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: '-100px' });
  const { showNotice } = useExchangeDevNotice();

  return (
    <section
      id="inr-fiat"
      ref={ref}
      className="relative py-24 md:py-32 overflow-hidden bg-surface"
      data-testid="inr-fiat-section"
    >
      <div className="absolute inset-0">
        <div className="absolute top-0 left-0 w-[500px] h-[500px] bg-[#0EA4AB]/6 rounded-full blur-3xl" />
        <div className="absolute bottom-0 right-1/4 w-[600px] h-[400px] bg-[#22c55e]/5 rounded-full blur-3xl" />
      </div>

      <div className="max-w-7xl mx-auto px-4 sm:px-6 md:px-10 xl:px-16 relative z-10">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.6 }}
          className="text-center mb-14 md:mb-16"
        >
          <span className="inline-flex items-center gap-2 bg-[#0EA4AB]/10 border border-[#0EA4AB]/30 px-4 py-2 rounded-full text-sm text-ink-accent font-medium mb-5">
            <IndianRupee size={16} />
            India · INR on Delta Exchange
          </span>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold text-ink mb-5 leading-tight">
            Deposit &amp; withdraw in
            <span className="text-ink-accent"> Indian Rupees</span>
          </h2>
          <p className="text-ink-muted text-lg md:text-xl max-w-3xl mx-auto leading-relaxed">
            Delta Exchange supports INR deposits and withdrawals for eligible Indian users.
            Fund your account with Indian Rupees, trade Delta, and cash out back to your bank or UPI —
            all tracked in your wallet with clear status updates.
          </p>
        </motion.div>

        <div className="grid md:grid-cols-3 gap-4 mb-12 max-w-4xl mx-auto">
          {highlights.map((item, i) => (
            <motion.div
              key={item.label}
              initial={{ opacity: 0, y: 16 }}
              animate={isInView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.15 + i * 0.08, duration: 0.5 }}
              className="flex flex-col items-center text-center p-5 rounded-2xl bg-surface-card/80 border border-line hover:border-[#0EA4AB]/40 transition-colors"
            >
              <div className="w-12 h-12 rounded-xl bg-logo-gradient flex items-center justify-center mb-3">
                <item.icon size={22} className="icon-on-gradient text-white" />
              </div>
              <p className="text-ink font-bold text-sm mb-1">{item.label}</p>
              <p className="text-ink-muted text-xs">{item.desc}</p>
            </motion.div>
          ))}
        </div>

        <div className="grid lg:grid-cols-2 gap-6 md:gap-8 mb-12">
          <motion.div
            initial={{ opacity: 0, x: -24 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.2 }}
            className="relative h-full bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-3xl p-8 md:p-10 overflow-hidden group hover:border-[#0EA4AB]/40 transition-colors"
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_left,rgba(34,197,94,0.08),transparent_55%)] opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-2xl bg-green-500/10 border border-green-500/25 flex items-center justify-center">
                  <ArrowDownCircle size={24} className="text-green-400" />
                </div>
                <div>
                  <p className="text-green-400 text-xs font-bold uppercase tracking-wider">Deposit</p>
                  <h3 className="text-xl md:text-2xl font-bold text-ink">Add INR → get Delta</h3>
                </div>
              </div>
              <p className="text-ink-muted text-sm md:text-base leading-relaxed mb-6">
                Buy crypto exposure by depositing Indian Rupees. Submit your transfer details and
                proof; once approved, Delta is added to your spot wallet so you can trade immediately.
              </p>
              <ul className="space-y-3 mb-8">
                {depositSteps.map((step) => (
                  <li key={step} className="flex items-start gap-3 text-sm text-ink-soft">
                    <CheckCircle size={16} className="text-ink-accent flex-shrink-0 mt-0.5" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
              <motion.button
                type="button"
                onClick={showNotice}
                className="inline-flex items-center gap-2 bg-logo-gradient text-[#050a1a] font-bold px-6 py-3.5 rounded-xl shadow-[0_0_20px_rgba(14,164,171,0.25)] hover:shadow-[0_0_28px_rgba(14,164,171,0.4)] transition-all"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                data-testid="inr-deposit-cta"
              >
                Deposit on Exchange
                <ArrowRight size={16} />
              </motion.button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 24 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.6, delay: 0.3 }}
            className="relative h-full bg-gradient-to-br from-surface-card to-surface-soft border border-line rounded-3xl p-8 md:p-10 overflow-hidden group hover:border-[#0EA4AB]/40 transition-colors"
          >
            <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top_right,rgba(14,164,171,0.12),transparent_55%)] opacity-0 group-hover:opacity-100 transition-opacity" />
            <div className="relative">
              <div className="flex items-center gap-3 mb-5">
                <div className="w-12 h-12 rounded-2xl bg-[#0EA4AB]/15 border border-[#0EA4AB]/30 flex items-center justify-center">
                  <ArrowUpCircle size={24} className="text-ink-accent" />
                </div>
                <div>
                  <p className="text-ink-accent text-xs font-bold uppercase tracking-wider">Withdraw</p>
                  <h3 className="text-xl md:text-2xl font-bold text-ink">Sell Delta → receive INR</h3>
                </div>
              </div>
              <p className="text-ink-muted text-sm md:text-base leading-relaxed mb-6">
                Convert your Delta balance back to Indian Rupees. Your Delta is reserved when you
                submit a payout request; INR is sent to your verified bank or UPI after admin approval.
              </p>
              <ul className="space-y-3 mb-8">
                {withdrawSteps.map((step) => (
                  <li key={step} className="flex items-start gap-3 text-sm text-ink-soft">
                    <CheckCircle size={16} className="text-ink-accent flex-shrink-0 mt-0.5" />
                    <span>{step}</span>
                  </li>
                ))}
              </ul>
              <motion.button
                type="button"
                onClick={showNotice}
                className="inline-flex items-center gap-2 bg-logo-gradient text-[#050a1a] font-bold px-6 py-3.5 rounded-xl shadow-[0_0_20px_rgba(14,164,171,0.25)] hover:shadow-[0_0_28px_rgba(14,164,171,0.4)] transition-all"
                whileHover={{ scale: 1.02 }}
                whileTap={{ scale: 0.98 }}
                data-testid="inr-withdraw-cta"
              >
                Withdraw on Exchange
                <ArrowRight size={16} />
              </motion.button>
            </div>
          </motion.div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={isInView ? { opacity: 1, y: 0 } : {}}
          transition={{ duration: 0.5, delay: 0.45 }}
          className="relative rounded-2xl border border-[#0EA4AB]/25 bg-gradient-to-r from-surface-card via-surface-soft to-surface-card px-6 py-5 md:px-8 md:py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4"
        >
          <div className="flex items-start gap-4">
            <Banknote size={28} className="text-ink-accent flex-shrink-0 mt-0.5" />
            <p className="text-ink-muted text-sm md:text-base leading-relaxed">
              <span className="text-ink font-semibold">Available on the live exchange.</span>
              {' '}
              Sign in at {EXCHANGE_URL_LABEL}, complete KYC where required, and manage INR deposits,
              payouts, and full transaction history under Wallet → History → INR history.
            </p>
          </div>
          <motion.button
            type="button"
            onClick={showNotice}
            className="inline-flex items-center justify-center gap-2 whitespace-nowrap text-[#050a1a] font-bold px-5 py-3 rounded-xl bg-logo-gradient flex-shrink-0"
            whileHover={{ scale: 1.02 }}
            whileTap={{ scale: 0.98 }}
          >
            Open {EXCHANGE_URL_LABEL}
            <ArrowRight size={16} />
          </motion.button>
        </motion.div>
      </div>
    </section>
  );
};

export default InrFiat;
