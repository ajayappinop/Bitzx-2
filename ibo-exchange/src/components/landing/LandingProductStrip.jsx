import { Link } from 'react-router-dom';

/** Product quick-links — Delta India product pillars */
const ITEMS = [
  {
    to: '/futures/BTCUSDT-PERP',
    label: 'Futures',
    sub: 'BTC · ETH · Perpetuals',
    icon: '/hero/platform-dollar-medal.png?v=11',
    glow: 'rgba(254, 108, 2,0.35)',
  },
  {
    to: '/options/BTCUSDT',
    label: 'Options',
    sub: 'Calls · Puts · Chain',
    icon: '/hero/feature-charts.png?v=1',
    glow: 'rgba(0, 168, 118,0.32)',
  },
  {
    to: '/trade/IBOUSDT',
    label: 'Spot',
    sub: 'Limit · Market · Charts',
    icon: '/hero/why-usdc-coin.png?v=1',
    glow: 'rgba(254, 108, 2,0.36)',
  },
  {
    to: '/wallet/deposit/inr',
    label: 'Deposit INR',
    sub: 'Bank · UPI rails',
    icon: '/hero/deposit-wallet.png?v=1',
    glow: 'rgba(0, 168, 118,0.34)',
  },
  {
    to: '/wallet/withdraw/inr',
    label: 'Withdraw INR',
    sub: 'Payout to bank / UPI',
    icon: '/hero/why-shield.png?v=11',
    glow: 'rgba(254, 108, 2,0.32)',
  },
  {
    to: '/account/kyc',
    label: 'Instant KYC',
    sub: 'Aadhaar · PAN · Face',
    icon: '/hero/why-secure-wallet.png?v=12',
    glow: 'rgba(180, 77, 1,0.3)',
  },
  {
    to: '/account/positions',
    label: 'Positions & P/L',
    sub: 'Real-time portfolio',
    icon: '/hero/why-crypto-cubes.png?v=11',
    glow: 'rgba(0, 168, 118,0.3)',
  },
  {
    to: '/markets',
    label: 'Markets',
    sub: '24h open markets',
    icon: '/hero/why-btc-coins.png?v=13',
    glow: 'rgba(254, 108, 2,0.34)',
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
          Futures · options · spot · INR
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
