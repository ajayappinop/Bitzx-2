/**

 * Landing — Delta token spotlight + deposit → trade user journey (responsive).

 */

import { Link } from 'react-router-dom';

import { motion } from 'framer-motion';

import { ArrowRight, TrendingUp, ChevronRight } from 'lucide-react';



const IBO_TOKEN_3D = '/hero/ibo-token-3d.png?v=10';

const CUBES_ICON = '/hero/platform-usdt.png?v=2';

const DEPOSIT_SHIELD = '/hero/deposit-shield.png?v=10';



const IBO_POINTS = [

  { n: '01', title: 'Native quote asset', desc: 'Trade altcoins against Delta on dedicated Delta Markets — not only USDT.' },

  { n: '02', title: 'Platform utility', desc: 'Fees, ecosystem pairs, and featured listings revolve around the Delta token.' },

  { n: '03', title: 'Live Delta/USDT', desc: 'Spot market with full 24h stats, depth, and TradingView charts like any major pair.' },

];



const DEPOSIT_PATHS = [

  {

    icon: '/hero/deposit-wallet.png?v=10',

    accent: 'rgba(96,165,250,0.45)',

    title: 'USDT & top assets',

    desc: 'Deposit stablecoins and majors to your secure wallet. Balances credit after on-chain confirmation.',

    link: '/wallet',

    cta: 'Deposit USDT',

  },

  {

    icon: '/hero/deposit-search.png?v=10',

    accent: 'rgba(254, 108, 2,0.45)',

    title: 'Any BEP-20 token',

    desc: 'Search by name or contract address — the same Web3 catalog as wallet deposit. Hundreds of BNB Chain tokens supported.',

    link: '/wallet',

    cta: 'Search tokens',

  },

  {

    icon: '/hero/deposit-coin.png?v=10',

    accent: 'rgba(0, 168, 118,0.4)',

    title: 'Listed project coins',

    desc: 'After listing approval, your token gets deposit, withdraw, and spot markets (USDT or Delta quote).',

    link: '/list-coin',

    cta: 'Apply to list',

  },

];



const JOURNEY_STEPS = [

  {

    n: '01',

    title: 'Create & verify',

    desc: 'Register in minutes. Complete KYC to unlock deposits, withdrawals, and full trading limits.',

    to: '/register',

    cta: 'Create account',

  },

  {

    n: '02',

    title: 'Deposit funds',

    desc: 'Open Wallet → Deposit. Add USDT or any supported BEP-20, then copy your address and send on the correct network.',

    to: '/wallet',

    cta: 'Go to wallet',

  },

  {

    n: '03',

    title: 'Pick a market',

    desc: 'USDT pairs for majors, or Delta Markets for Web3 tokens quoted in Delta. Browse live 24h stats before you trade.',

    to: '/markets',

    cta: 'Browse markets',

    altTo: '/ibo-markets',

    altCta: 'Delta Markets',

  },

  {

    n: '04',

    title: 'Trade & track',

    desc: 'Use limit or market orders, live order book, TradingView charts, and portfolio P&L — on web or mobile app.',

    to: '/trade/IBOUSDT',

    cta: 'Open terminal',

  },

];



function splitTitle(title) {

  const i = title.indexOf(' ');

  if (i === -1) return { lead: title, rest: '' };

  return { lead: title.slice(0, i), rest: title.slice(i + 1) };

}



function JourneyStep({ step, index, align = 'left' }) {

  const right = align === 'right';

  const { lead, rest } = splitTitle(step.title);



  return (

    <motion.article

      initial={{ opacity: 0, y: 18, x: right ? 12 : -12 }}

      whileInView={{ opacity: 1, y: 0, x: 0 }}

      viewport={{ once: true, margin: '-40px' }}

      transition={{ delay: index * 0.07, duration: 0.45 }}

      className={`relative flex flex-col min-w-0 max-w-md pt-8 sm:pt-10 ${right ? 'lg:ml-auto lg:items-end lg:text-right' : 'lg:mr-auto'}`}

    >

      <span

        aria-hidden

        className={`pointer-events-none absolute -top-1 z-0 select-none font-display font-bold leading-none text-[5.5rem] sm:text-[6.75rem] text-white/[0.055] ${

          right

            ? 'left-3 sm:left-4' /* outer top-left, nudged inward */

            : 'left-3 sm:left-4 lg:left-auto lg:right-3 xl:right-4' /* outer top-right, nudged inward */

        }`}

      >

        {step.n}

      </span>



      <div className="relative z-[1]">

        <h3 className="font-display text-[1.35rem] sm:text-[1.5rem] leading-tight tracking-tight mb-2.5">

          <span className="font-bold text-white">{lead}</span>

          {rest ? <span className="font-medium text-gradient"> {rest}</span> : null}

        </h3>

        <p className="text-zinc-400 text-[14px] sm:text-[15px] leading-[1.65]">{step.desc}</p>

        <div className={`mt-4 flex flex-wrap items-center gap-3 ${right ? 'lg:justify-end' : ''}`}>

          <Link

            to={step.to}

            className="inline-flex items-center gap-1.5 text-[14px] font-semibold text-gold-light hover:text-gold transition-colors"

          >

            {step.cta} <ChevronRight size={14} />

          </Link>

          {step.altTo ? (

            <Link

              to={step.altTo}

              className="inline-flex items-center gap-1.5 text-[13px] font-medium text-zinc-400 hover:text-white transition-colors"

            >

              {step.altCta} <ArrowRight size={13} />

            </Link>

          ) : null}

        </div>

      </div>

    </motion.article>

  );

}



function CubesCenterpiece() {

  return (

    <motion.div

      initial={{ opacity: 0, scale: 0.92 }}

      whileInView={{ opacity: 1, scale: 1 }}

      viewport={{ once: true }}

      transition={{ duration: 0.55 }}

      className="relative flex items-center justify-center py-6 lg:py-4 overflow-visible"

    >

      <div

        className="pointer-events-none absolute inset-0 m-auto h-[70%] w-[70%] rounded-full blur-3xl opacity-70"

        style={{

          background:

            'radial-gradient(circle, rgba(254, 108, 2,0.22) 0%, rgba(77,138,255,0.1) 42%, transparent 70%)',

        }}

      />

      <div

        className="pointer-events-none absolute inset-[8%] rounded-full border border-white/[0.06]"

        style={{ boxShadow: 'inset 0 0 40px rgba(254, 108, 2,0.06)' }}

      />

      <img

        src={CUBES_ICON}

        alt="Multi-asset trading — USDT processing"

        className="ibo-3d-icon ibo-3d-icon--lg platform-cubes-float relative z-[1] w-[min(100%,320px)] sm:w-[340px] lg:w-[320px] xl:w-[380px] h-auto"

        draggable={false}

        loading="lazy"

        decoding="async"

      />

    </motion.div>

  );

}



export default function LandingPlatformFlow() {

  return (

    <div className="space-y-0">

      {/* ── Delta token spotlight ── */}

      <section

        className="relative border-y border-white/[0.06] overflow-hidden"

        style={{ background: 'var(--ibo-bg)' }}

      >

        <div

          className="pointer-events-none absolute inset-0"

          style={{

            background:

              'radial-gradient(ellipse 55% 45% at 70% 40%, rgba(254, 108, 2,0.10) 0%, transparent 60%), radial-gradient(ellipse 40% 35% at 20% 75%, rgba(0, 168, 118,0.06) 0%, transparent 55%)',

          }}

        />



        <div className="relative ibo-landing-container ibo-section-y">

          <div className="grid lg:grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] gap-10 lg:gap-6 xl:gap-10 items-center">

            {/* Copy */}

            <motion.div

              initial={{ opacity: 0, x: -20 }}

              whileInView={{ opacity: 1, x: 0 }}

              viewport={{ once: true }}

              transition={{ duration: 0.5 }}

              className="min-w-0 order-2 lg:order-1 relative z-[1]"

            >

              <p className="ibo-eyebrow mb-3">Platform token</p>

              <h2 className="ibo-title-lg mb-4 max-w-xl">

                Meet{' '}

                <span

                  className="bg-clip-text text-transparent"

                  style={{

                    backgroundImage: 'linear-gradient(115deg, #4D8AFF 0%, #FE6C02 45%, #00A876 100%)',

                  }}

                >

                  Delta

                </span>

                {' '}— the heart of the exchange

              </h2>

              <p className="ibo-lead text-zinc-400 max-w-lg mb-8">

                Delta is our native token and quote currency for Web3 markets. Hold Delta to trade hundreds of

                project tokens, access Delta/USDT spot, and participate in the ecosystem we are building on BNB Chain.

              </p>



              <div className="flex flex-col sm:flex-row flex-wrap gap-3 mb-10">

                <Link

                  to="/trade/IBOUSDT"

                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-logo-gradient px-6 py-3.5 text-[15px] font-semibold text-surface-dark shadow-[0_12px_40px_rgba(254, 108, 2,0.25)]"

                >

                  Trade Delta/USDT <TrendingUp size={18} />

                </Link>

                <Link

                  to="/ibo-markets"

                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 bg-white/[0.03] px-6 py-3.5 text-[15px] font-medium text-white hover:bg-white/[0.07] backdrop-blur-sm ibo-btn-outline"

                >

                  Explore Delta Markets <ArrowRight size={18} className="text-[#FE6C02]" />

                </Link>

              </div>



              <ul className="grid sm:grid-cols-3 gap-6 sm:gap-5">

                {IBO_POINTS.map((p, i) => (

                  <motion.li

                    key={p.title}

                    initial={{ opacity: 0, y: 12 }}

                    whileInView={{ opacity: 1, y: 0 }}

                    viewport={{ once: true }}

                    transition={{ delay: 0.1 + i * 0.08 }}

                    className="relative min-w-0 pt-6"

                  >

                    <span

                      aria-hidden

                      className="pointer-events-none absolute top-0 left-0 select-none font-display font-bold text-[2.75rem] leading-none text-white/[0.06]"

                    >

                      {p.n}

                    </span>

                    <p className="relative font-display font-bold text-white text-[15px] mb-1.5 tracking-tight">

                      {p.title}

                    </p>

                    <p className="relative text-[13px] text-zinc-500 leading-relaxed">{p.desc}</p>

                  </motion.li>

                ))}

              </ul>

            </motion.div>



            {/* 3D token */}

            <motion.div

              initial={{ opacity: 0, scale: 0.9 }}

              whileInView={{ opacity: 1, scale: 1 }}

              viewport={{ once: true }}

              transition={{ duration: 0.6 }}

              className="relative order-1 lg:order-2 flex items-center justify-center min-h-[280px] sm:min-h-[340px] lg:min-h-[420px]"

            >

              {/* Soft brand glow behind token */}

              <div

                aria-hidden

                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[78%] h-[78%] max-w-[440px] rounded-full blur-3xl opacity-80"

                style={{

                  background:

                    'radial-gradient(circle, rgba(254, 108, 2,0.42) 0%, rgba(0, 168, 118,0.22) 38%, rgba(180, 77, 1,0.1) 58%, transparent 72%)',

                }}

              />

              <div

                aria-hidden

                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[48%] h-[48%] max-w-[260px] rounded-full blur-2xl opacity-90"

                style={{

                  background:

                    'radial-gradient(circle, rgba(254, 108, 2,0.5) 0%, rgba(0, 168, 118,0.28) 50%, transparent 70%)',

                }}

              />

              <div

                aria-hidden

                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[88%] max-w-[420px] aspect-square rounded-full border border-[rgba(254, 108, 2,0.18)]"

                style={{ boxShadow: 'inset 0 0 50px rgba(254, 108, 2,0.1), 0 0 60px rgba(254, 108, 2,0.14)' }}

              />

              <div

                aria-hidden

                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[68%] max-w-[320px] aspect-square rounded-full border border-[rgba(0, 168, 118,0.2)]"

                style={{ boxShadow: '0 0 36px rgba(0, 168, 118,0.12)' }}

              />

              <img

                src={IBO_TOKEN_3D}

                alt="Delta token"

                className="ibo-3d-icon ibo-3d-icon--glow ibo-token-float relative z-[1] w-[min(100%,300px)] sm:w-[340px] lg:w-[380px] xl:w-[420px] h-auto"

                draggable={false}

                loading="lazy"

                decoding="async"

              />

            </motion.div>

          </div>

        </div>

      </section>



      {/* ── How to deposit ── */}

      <section className="relative overflow-hidden" style={{ background: 'var(--ibo-bg)' }}>

        <div

          className="pointer-events-none absolute inset-0"

          style={{

            background:

              'radial-gradient(ellipse 50% 40% at 12% 25%, rgba(254, 108, 2,0.07) 0%, transparent 55%), radial-gradient(ellipse 40% 35% at 88% 70%, rgba(0, 168, 118,0.05) 0%, transparent 50%)',

          }}

        />



        <div className="relative ibo-landing-container ibo-section-y">

          <motion.div

            initial={{ opacity: 0, y: 16 }}

            whileInView={{ opacity: 1, y: 0 }}

            viewport={{ once: true }}

            className="max-w-2xl mb-12 md:mb-16"

          >

            <p className="ibo-eyebrow mb-3">Fund your account</p>

            <h2 className="ibo-title-lg mb-4">How deposits work</h2>

            <p className="ibo-lead text-zinc-400">

              One wallet for stablecoins, majors, and the full BEP-20 catalog. Search a token, copy your deposit

              address, and send on the correct network.

            </p>

          </motion.div>



          <div className="grid gap-10 sm:gap-8 lg:gap-0 sm:grid-cols-3 lg:divide-x lg:divide-white/[0.06]">

            {DEPOSIT_PATHS.map((d, i) => (

              <motion.article

                key={d.title}

                initial={{ opacity: 0, y: 22 }}

                whileInView={{ opacity: 1, y: 0 }}

                viewport={{ once: true }}

                transition={{ delay: i * 0.08, duration: 0.45 }}

                className="group relative flex flex-col min-w-0 sm:px-2 lg:px-8 first:lg:pl-0 last:lg:pr-0"

              >

                <div className="relative mb-6 flex h-[120px] sm:h-[132px] items-end justify-start">

                  <div

                    className="pointer-events-none absolute left-2 bottom-2 h-20 w-20 rounded-full blur-2xl opacity-70 transition-opacity duration-500 group-hover:opacity-100"

                    style={{ background: d.accent }}

                  />

                  <img

                    src={d.icon}

                    alt=""

                    className="ibo-3d-icon ibo-3d-icon--sm relative z-[1] h-[108px] sm:h-[120px] w-auto object-contain transition-transform duration-500 group-hover:-translate-y-1.5"

                    draggable={false}

                    loading="lazy"

                    decoding="async"

                  />

                </div>

                <h3 className="font-display text-[1.2rem] sm:text-[1.3rem] font-bold tracking-tight text-white mb-2.5">

                  {d.title}

                </h3>

                <p className="text-zinc-400 text-[14px] sm:text-[15px] leading-[1.65] flex-1 max-w-sm">

                  {d.desc}

                </p>

                <Link

                  to={d.link}

                  className="mt-5 inline-flex items-center gap-1.5 self-start rounded-full px-4 py-2 text-[13px] sm:text-[14px] font-bold transition-all duration-250 hover:brightness-110"

                  style={{

                    color: 'var(--ibo-accent)',

                    background: 'linear-gradient(135deg, rgba(254, 108, 2,0.14) 0%, rgba(0, 168, 118,0.1) 100%)',

                    border: '1px solid rgba(254, 108, 2,0.35)',

                    boxShadow: '0 6px 18px rgba(254, 108, 2,0.12)',

                  }}

                >

                  {d.cta} <ChevronRight size={14} />

                </Link>

              </motion.article>

            ))}

          </div>



          <motion.div

            initial={{ opacity: 0, y: 10 }}

            whileInView={{ opacity: 1, y: 0 }}

            viewport={{ once: true }}

            className="mt-12 md:mt-16 flex flex-col sm:flex-row sm:items-center gap-5 sm:gap-6 border-t border-white/[0.07] pt-8"

          >

            <img

              src={DEPOSIT_SHIELD}

              alt=""

              className="ibo-3d-icon ibo-3d-icon--sm h-14 w-14 sm:h-16 sm:w-16 shrink-0 object-contain"

              draggable={false}

              loading="lazy"

              decoding="async"

            />

            <p className="text-[13px] sm:text-sm text-zinc-400 leading-relaxed flex-1 min-w-0">

              <span className="font-display font-semibold text-white">Security.</span>{' '}

              Deposits use per-user addresses where configured. Always verify network (e.g. BEP-20 on BNB Chain)

              before sending. Unsupported or wrong-network transfers may be lost.

            </p>

            <Link

              to="/wallet"

              className="shrink-0 inline-flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-bold whitespace-nowrap transition-all duration-250 hover:brightness-110"

              style={{

                color: 'var(--ibo-accent)',

                background: 'linear-gradient(135deg, rgba(254, 108, 2,0.14) 0%, rgba(0, 168, 118,0.1) 100%)',

                border: '1px solid rgba(254, 108, 2,0.35)',

                boxShadow: '0 6px 18px rgba(254, 108, 2,0.12)',

              }}

            >

              Open wallet <ArrowRight size={14} />

            </Link>

          </motion.div>

        </div>

      </section>



      {/* ── End-to-end journey ── */}

      <section

        className="border-y border-white/[0.06] overflow-visible"

        style={{ background: 'var(--ibo-bg)' }}

      >

        <div className="ibo-landing-container ibo-section-y">

          <motion.div

            initial={{ opacity: 0, y: 16 }}

            whileInView={{ opacity: 1, y: 0 }}

            viewport={{ once: true }}

            className="text-center max-w-2xl mx-auto mb-10 md:mb-12"

          >

            <p className="ibo-eyebrow mb-3">Your path</p>

            <h2 className="ibo-title-lg mb-4">From signup to your first trade</h2>

            <p className="ibo-lead-wide text-zinc-400 mx-auto">

              A clear, guided flow on web and mobile — the same steps whether you trade USDT pairs or Delta-quoted Web3 tokens.

            </p>

          </motion.div>



          {/* Mobile / tablet: icon first, steps stack */}

          <div className="lg:hidden space-y-8">

            <CubesCenterpiece />

            <div className="grid gap-8 sm:grid-cols-2">

              {JOURNEY_STEPS.map((step, i) => (

                <JourneyStep key={step.n} step={step} index={i} />

              ))}

            </div>

          </div>



          {/* Desktop: steps orbit the 3D cubes */}

          <div className="hidden lg:grid grid-cols-[minmax(0,1fr)_minmax(300px,400px)_minmax(0,1fr)] grid-rows-2 gap-x-10 xl:gap-x-14 gap-y-12 xl:gap-y-16 items-center overflow-visible">

            <JourneyStep step={JOURNEY_STEPS[0]} index={0} align="right" />

            <div className="row-span-2 self-center overflow-visible">

              <CubesCenterpiece />

            </div>

            <JourneyStep step={JOURNEY_STEPS[1]} index={1} align="left" />

            <JourneyStep step={JOURNEY_STEPS[2]} index={2} align="right" />

            <JourneyStep step={JOURNEY_STEPS[3]} index={3} align="left" />

          </div>



          <div className="hidden lg:flex items-center justify-center gap-2 mt-10 text-zinc-600 text-xs font-mono uppercase tracking-widest">

            <span>Register</span>

            <ArrowRight size={12} />

            <span>Deposit</span>

            <ArrowRight size={12} />

            <span>Market</span>

            <ArrowRight size={12} />

            <span>Trade</span>

          </div>



          <motion.div

            initial={{ opacity: 0, y: 12 }}

            whileInView={{ opacity: 1, y: 0 }}

            viewport={{ once: true }}

            className="mt-10 md:mt-12 flex flex-col sm:flex-row flex-wrap justify-center gap-3"

          >

            <Link

              to="/register"

              className="inline-flex items-center justify-center gap-2 rounded-xl bg-logo-gradient px-8 py-3.5 text-[15px] font-semibold text-surface-dark"

            >

              Get started free <ArrowRight size={18} />

            </Link>

            <Link

              to="/quick-trade"

              className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/12 px-8 py-3.5 text-[15px] font-medium text-white hover:bg-white/[0.05] ibo-btn-outline"

            >

              Try quick trade

            </Link>

          </motion.div>

        </div>

      </section>

    </div>

  );

}

