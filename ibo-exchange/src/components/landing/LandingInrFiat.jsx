/**

 * Landing — INR deposit & INR payout (sell Delta) for Indian users.

 */

import { Link } from 'react-router-dom';

import { motion } from 'framer-motion';

import { useAuth } from '@/context/AuthContext';

import {

  ArrowRight,

  ArrowDownCircle,

  ArrowUpCircle,

  CheckCircle,

  IndianRupee,

  Banknote,

} from 'lucide-react';

import { InrMinDepositChip, InrMinDepositNote } from '@/components/inr/InrMinDepositChip';

import { useInrMinDeposit } from '@/hooks/useInrMinDeposit';



export default function LandingInrFiat() {

  const { user, authLoading } = useAuth();

  const { minDepositInr } = useInrMinDeposit();



  return (

    <section

      id="inr-fiat"

      className="relative border-y border-white/[0.06] overflow-hidden"

      style={{ background: 'linear-gradient(180deg, var(--ibo-bg) 0%, var(--ibo-surface) 50%, var(--ibo-bg) 100%)' }}

    >

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_60%_50%_at_80%_30%,rgba(34,197,94,0.07),transparent_55%)]" />

      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_50%_40%_at_15%_70%,rgba(254, 108, 2,0.1),transparent_50%)]" />



      <div className="relative ibo-landing-container ibo-section-y">

        <motion.div

          initial={{ opacity: 0, y: 16 }}

          whileInView={{ opacity: 1, y: 0 }}

          viewport={{ once: true }}

          className="text-center max-w-3xl mx-auto mb-10 md:mb-14"

        >

          <p className="ibo-eyebrow mb-3 inline-flex items-center justify-center gap-2">

            <IndianRupee size={14} className="text-gold-light" />

            India · INR

          </p>

          <h2 className="ibo-title-lg mb-4">

            Deposit &amp; withdraw in <span className="text-gradient">Indian Rupees</span>

          </h2>

          <p className="ibo-lead text-zinc-400 max-w-none">

            Add INR via bank or UPI and receive Delta after review. When you are ready to cash out, sell Delta and

            get INR paid to your linked bank or UPI — with full status in Wallet → History → INR history.

          </p>

        </motion.div>



        <div className="grid md:grid-cols-2 gap-5 lg:gap-6 max-w-5xl mx-auto">

          <motion.article

            initial={{ opacity: 0, x: -16 }}

            whileInView={{ opacity: 1, x: 0 }}

            viewport={{ once: true }}

            whileHover={{ y: -3 }}

            className="relative rounded-2xl border p-6 sm:p-8 flex flex-col h-full overflow-hidden transition-[border-color,box-shadow] duration-300"

            style={{

              borderColor: 'rgba(254, 108, 2,0.28)',

              background:

                'linear-gradient(155deg, rgba(254, 108, 2,0.14) 0%, color-mix(in srgb, var(--ibo-card) 92%, transparent) 42%, rgba(0, 168, 118,0.08) 100%)',

              boxShadow: '0 16px 40px rgba(254, 108, 2,0.08), var(--ibo-shadow)',

            }}

          >

            <div

              aria-hidden

              className="pointer-events-none absolute inset-x-0 top-0 h-px"

              style={{

                background: 'linear-gradient(90deg, transparent, rgba(254, 108, 2,0.55), transparent)',

              }}

            />

            <div

              aria-hidden

              className="pointer-events-none absolute -right-8 -top-10 w-40 h-40 rounded-full blur-3xl opacity-50"

              style={{ background: 'radial-gradient(circle, rgba(254, 108, 2,0.28) 0%, transparent 70%)' }}

            />



            <div className="relative flex items-center gap-3 mb-4">

              <div

                className="flex h-12 w-12 items-center justify-center rounded-xl border shrink-0"

                style={{

                  background: 'linear-gradient(145deg, rgba(254, 108, 2,0.22) 0%, rgba(254, 108, 2,0.08) 100%)',

                  borderColor: 'rgba(254, 108, 2,0.4)',

                  color: '#FE6C02',

                  boxShadow: '0 8px 20px rgba(254, 108, 2,0.18)',

                }}

              >

                <ArrowDownCircle size={24} />

              </div>

              <div className="min-w-0">

                <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#FE6C02' }}>

                  Deposit

                </p>

                <div className="flex flex-wrap items-center gap-2">

                  <h3 className="font-semibold text-xl" style={{ color: 'var(--ibo-ink)' }}>

                    INR in → Delta credited

                  </h3>

                  <InrMinDepositChip minDepositInr={minDepositInr} />

                </div>

              </div>

            </div>

            <p

              className="relative text-[14px] sm:text-[15px] leading-[1.65] mb-2 flex-1"

              style={{ color: 'var(--ibo-ink-secondary)' }}

            >

              Transfer Indian Rupees using our payment details, submit your UTR and proof, and trade once Delta is

              added to your spot balance.

            </p>

            <InrMinDepositNote minDepositInr={minDepositInr} className="mb-5" />

            <ul className="relative space-y-2.5 mb-6">

              {['Bank transfer or UPI', 'UTR + payment proof in wallet', 'Delta credited after admin review'].map((t) => (

                <li key={t} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--ibo-ink)' }}>

                  <CheckCircle size={15} className="shrink-0 mt-0.5" style={{ color: '#FE6C02' }} />

                  {t}

                </li>

              ))}

            </ul>

            <Link

              to="/wallet/deposit/inr"

              className="relative inline-flex items-center justify-center gap-2 rounded-xl bg-logo-gradient px-6 py-3 text-[15px] font-semibold text-surface-dark w-full sm:w-auto shadow-[0_12px_28px_rgba(254, 108, 2,0.22)] hover:brightness-110 transition-[filter]"

            >

              Deposit INR <ArrowRight size={16} />

            </Link>

          </motion.article>



          <motion.article

            initial={{ opacity: 0, x: 16 }}

            whileInView={{ opacity: 1, x: 0 }}

            viewport={{ once: true }}

            whileHover={{ y: -3 }}

            className="relative rounded-2xl border p-6 sm:p-8 flex flex-col h-full overflow-hidden transition-[border-color,box-shadow] duration-300"

            style={{

              borderColor: 'rgba(0, 168, 118,0.32)',

              background:

                'linear-gradient(155deg, rgba(0, 168, 118,0.14) 0%, color-mix(in srgb, var(--ibo-card) 92%, transparent) 42%, rgba(254, 108, 2,0.08) 100%)',

              boxShadow: '0 16px 40px rgba(0, 168, 118,0.08), var(--ibo-shadow)',

            }}

          >

            <div

              aria-hidden

              className="pointer-events-none absolute inset-x-0 top-0 h-px"

              style={{

                background: 'linear-gradient(90deg, transparent, rgba(0, 168, 118,0.55), transparent)',

              }}

            />

            <div

              aria-hidden

              className="pointer-events-none absolute -right-8 -top-10 w-40 h-40 rounded-full blur-3xl opacity-50"

              style={{ background: 'radial-gradient(circle, rgba(0, 168, 118,0.28) 0%, transparent 70%)' }}

            />



            <div className="relative flex items-center gap-3 mb-4">

              <div

                className="flex h-12 w-12 items-center justify-center rounded-xl border shrink-0"

                style={{

                  background: 'linear-gradient(145deg, rgba(0, 168, 118,0.28) 0%, rgba(0, 168, 118,0.08) 100%)',

                  borderColor: 'rgba(0, 168, 118,0.45)',

                  color: '#a8c73a',

                  boxShadow: '0 8px 20px rgba(0, 168, 118,0.18)',

                }}

              >

                <ArrowUpCircle size={24} />

              </div>

              <div>

                <p className="text-[11px] font-bold uppercase tracking-[0.16em]" style={{ color: '#a8c73a' }}>

                  Withdraw

                </p>

                <h3 className="font-semibold text-xl" style={{ color: 'var(--ibo-ink)' }}>

                  Sell Delta → INR out

                </h3>

              </div>

            </div>

            <p

              className="relative text-[14px] sm:text-[15px] leading-[1.65] mb-5 flex-1"

              style={{ color: 'var(--ibo-ink-secondary)' }}

            >

              Sell Delta from your wallet, request an INR payout to your verified bank or UPI, and track approval

              with payout reference in your history.

            </p>

            <ul className="relative space-y-2.5 mb-6">

              {['Delta reserved when you submit', 'INR to bank or UPI after review', 'Email updates on status'].map((t) => (

                <li key={t} className="flex items-start gap-2.5 text-sm" style={{ color: 'var(--ibo-ink)' }}>

                  <CheckCircle size={15} className="shrink-0 mt-0.5" style={{ color: '#a8c73a' }} />

                  {t}

                </li>

              ))}

            </ul>

            <Link

              to="/wallet/withdraw/inr"

              className="relative inline-flex items-center justify-center gap-2 rounded-xl px-6 py-3 text-[15px] font-semibold w-full sm:w-auto transition-colors border"

              style={{

                borderColor: 'rgba(0, 168, 118,0.4)',

                background: 'linear-gradient(135deg, rgba(0, 168, 118,0.16) 0%, rgba(254, 108, 2,0.1) 100%)',

                color: 'var(--ibo-ink)',

              }}

            >

              Sell for INR <ArrowRight size={16} />

            </Link>

          </motion.article>

        </div>



        {!authLoading && user ? (

          <motion.div

            initial={{ opacity: 0, y: 12 }}

            whileInView={{ opacity: 1, y: 0 }}

            viewport={{ once: true }}

            className="mt-8 max-w-5xl mx-auto rounded-2xl border border-gold/20 bg-gold/[0.04] px-5 py-4 sm:px-6 sm:py-5 flex flex-col sm:flex-row sm:items-center gap-4"

          >

            <Banknote size={22} className="text-gold-light shrink-0 hidden sm:block" />

            <p className="text-sm sm:text-[15px] text-zinc-400 leading-relaxed flex-1">

              <span className="text-white font-medium">KYC may be required</span> before INR deposit or payout.

              Manage all requests under{' '}

              <Link to="/wallet?tab=history" className="text-gold-light hover:text-gold font-medium">

                Wallet → History

              </Link>

              .

            </p>

            <Link

              to="/wallet?tab=history&inr=withdraw"

              className="text-[14px] font-semibold text-gold-light hover:text-gold whitespace-nowrap inline-flex items-center gap-1"

            >

              INR history <ArrowRight size={14} />

            </Link>

          </motion.div>

        ) : null}

      </div>

    </section>

  );

}

