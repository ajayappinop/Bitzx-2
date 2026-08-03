import { Link } from 'react-router-dom';



/** Product quick-links — content-matched 3D icons + infinite carousel. */

const ITEMS = [

  {

    to: '/kyc',

    label: 'Instant KYC',

    sub: 'Aadhaar · PAN · Face · Bank',

    icon: '/hero/why-secure-wallet.png?v=12',

    glow: 'rgba(254, 108, 2,0.35)',

  },

  {

    to: '/wallet',

    label: 'Deposit',

    sub: 'USDT · BEP-20 search',

    icon: '/hero/deposit-wallet.png?v=1',

    glow: 'rgba(0, 168, 118,0.32)',

  },

  {

    to: '/wallet?tab=swap',

    label: 'Swap',

    sub: 'Delta ↔ USDT instant',

    icon: '/hero/ibo-token-3d.png?v=1',

    glow: 'rgba(254, 108, 2,0.38)',

  },

  {

    to: '/trade/IBOUSDT',

    label: 'Spot trade',

    sub: 'Limit · Market · Charts',

    icon: '/hero/feature-charts.png?v=1',

    glow: 'rgba(180, 77, 1,0.3)',

  },

  {

    to: '/ibo-markets',

    label: 'Delta Markets',

    sub: 'Web3 · Delta quote',

    icon: '/hero/why-crypto-cubes.png?v=11',

    glow: 'rgba(0, 168, 118,0.34)',

  },

  {

    to: '/markets',

    label: 'USDT Markets',

    sub: 'Majors · 24h data',

    icon: '/hero/why-usdc-coin.png?v=1',

    glow: 'rgba(254, 108, 2,0.36)',

  },

  {

    to: '/dashboard',

    label: 'Portfolio',

    sub: 'P&L · Balances',

    icon: '/hero/platform-dollar-medal.png?v=11',

    glow: 'rgba(0, 168, 118,0.3)',

  },

  {

    to: '/list-coin',

    label: 'List your coin',

    sub: 'Apply for listing',

    icon: '/hero/why-btc-coins.png?v=13',

    glow: 'rgba(254, 108, 2,0.32)',

  },

];



function StripItem({ to, label, sub, icon, glow }) {

  return (

    <Link to={to} className="product-strip-item group">

      <span className="product-strip-icon-wrap" style={{ '--strip-glow': glow }}>

        <span className="product-strip-icon-glow" aria-hidden />

        <img

          src={icon}

          alt=""

          aria-hidden

          className="product-strip-icon"

          draggable={false}

          decoding="async"

        />

      </span>

      <span className="product-strip-copy">

        <span className="product-strip-label">{label}</span>

        <span className="product-strip-sub">{sub}</span>

      </span>

    </Link>

  );

}



/**

 * Brand product strip — content icons, soft chips, infinite loop scroll.

 */

export default function LandingProductStrip() {

  const loop = [...ITEMS, ...ITEMS];



  return (

    <section

      className="relative border-y border-white/[0.06] overflow-hidden"

      style={{ background: 'var(--ibo-bg)' }}

    >

      <div

        aria-hidden

        className="pointer-events-none absolute inset-0"

        style={{

          background:

            'radial-gradient(ellipse 50% 80% at 50% 0%, rgba(254, 108, 2,0.06) 0%, transparent 60%)',

        }}

      />



      <div className="relative ibo-landing-container pt-7 md:pt-8 pb-2">

        <p className="text-center ibo-eyebrow mb-5 tracking-[0.22em]">

          Deposit · trade · track — one platform

        </p>

      </div>



      <div className="relative pb-7 md:pb-8">

        <div className="pointer-events-none absolute inset-y-0 left-0 z-[2] w-16 sm:w-28 bg-gradient-to-r from-[color:var(--ibo-bg)] to-transparent" />

        <div className="pointer-events-none absolute inset-y-0 right-0 z-[2] w-16 sm:w-28 bg-gradient-to-l from-[color:var(--ibo-bg)] to-transparent" />



        <div className="product-strip-marquee">

          <div className="product-strip-track">

            {loop.map((item, i) => (

              <StripItem key={`${item.to}-${i}`} {...item} />

            ))}

          </div>

        </div>

      </div>

    </section>

  );

}

