import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowLeftRight,
  Plus,
  Loader2,
  AlertCircle,
  Search,
  RefreshCw,
  ShieldCheck,
  Banknote,
  Store,
  ChevronRight,
  IndianRupee,
} from 'lucide-react';
import { p2pApi } from '@/services/p2pApi';
import { useAuth } from '@/context/AuthContext';

const ASSETS = ['USDT', 'BTC', 'ETH', 'BNB', 'SOL', 'XRP'];
const PMS = ['UPI', 'IMPS', 'BANK', 'PAYTM', 'PHONEPE', 'GPAY'];

const fmtINR = (v) =>
  Number(v || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });

function OfferCard({ ad, side }) {
  const name = ad.maker?.nickname || 'Trader';
  const initial = name[0]?.toUpperCase() || 'T';
  const payments = ad.payment_methods || [];
  const rate = ad.maker?.completion_rate_30d ?? 100;
  const trades = ad.maker?.trades_total ?? 0;

  return (
    <article className="p2p-card">
      <div className="p2p-card__top">
        <div className="p2p-card__trader">
          <div className="p2p-card__avatar" aria-hidden>
            {initial}
          </div>
          <div className="min-w-0">
            <div className="p2p-card__name">
              <span className="truncate">{name}</span>
              {ad.maker?.is_merchant ? (
                <ShieldCheck size={13} className="p2p-card__merchant" aria-label="Merchant" />
              ) : null}
            </div>
            <p className="p2p-card__stats">
              {trades} trades · {Number(rate).toFixed(0)}% done
            </p>
          </div>
        </div>
        <div className="p2p-card__price-block">
          <p className="p2p-card__price">
            <span className="p2p-card__rupee">₹</span>
            {fmtINR(ad.price)}
          </p>
          <p className="p2p-card__price-hint">per {ad.asset}</p>
        </div>
      </div>

      <div className="p2p-card__metrics">
        <div>
          <p className="p2p-card__m-label">Available</p>
          <p className="p2p-card__m-val tabular-nums">
            {Number(ad.available_amount || 0).toFixed(4)}{' '}
            <span className="p2p-card__m-unit">{ad.asset}</span>
          </p>
        </div>
        <div>
          <p className="p2p-card__m-label">Order limit</p>
          <p className="p2p-card__m-val tabular-nums">
            ₹{fmtINR(ad.min_order_inr)} – ₹{fmtINR(ad.max_order_inr)}
          </p>
        </div>
      </div>

      <div className="p2p-card__bottom">
        <div className="p2p-card__pays">
          {payments.slice(0, 4).map((p) => (
            <span key={p.pm_id} className="p2p-pay-chip">
              {p.type}
            </span>
          ))}
          {payments.length > 4 ? (
            <span className="p2p-pay-chip p2p-pay-chip--muted">+{payments.length - 4}</span>
          ) : null}
          {payments.length === 0 ? (
            <span className="p2p-pay-chip p2p-pay-chip--muted">Any</span>
          ) : null}
        </div>
        <Link
          to={`/p2p/ads/${ad.ad_id}`}
          className={`p2p-trade-btn p2p-trade-btn--${side === 'buy' ? 'buy' : 'sell'}`}
        >
          {side === 'buy' ? 'Buy' : 'Sell'} {ad.asset}
          <ChevronRight size={14} />
        </Link>
      </div>
    </article>
  );
}

export default function P2PMarketplacePage() {
  const { user } = useAuth();
  const [side, setSide] = useState('buy');
  const [asset, setAsset] = useState('USDT');
  const [pm, setPm] = useState('');
  const [amount, setAmount] = useState('');
  const [ads, setAds] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const params = { side, asset, fiat: 'INR', limit: 40 };
      if (pm) params.payment_type = pm;
      if (amount) params.amount = amount;
      const data = await p2pApi.listAds(params);
      setAds(data.ads || []);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [side, asset, pm]); // eslint-disable-line react-hooks/exhaustive-deps

  const bestPrice = useMemo(() => {
    if (!ads?.length) return null;
    const prices = ads.map((a) => Number(a.price) || 0).filter((n) => n > 0);
    if (!prices.length) return null;
    return side === 'buy' ? Math.min(...prices) : Math.max(...prices);
  }, [ads, side]);

  const countLabel =
    ads == null ? '—' : loading ? '…' : `${ads.length} offer${ads.length === 1 ? '' : 's'}`;

  return (
    <div className="ibo-page font-ui p2p-market">
      <div className="p2p-market__shell">
        {/* Slim command bar */}
        <header className="p2p-bar">
          <div className="p2p-bar__brand">
            <span className="p2p-bar__mark" aria-hidden>
              <ArrowLeftRight size={16} strokeWidth={2.2} />
            </span>
            <div className="min-w-0">
              <h1 className="p2p-bar__title">P2P Exchange</h1>
              <p className="p2p-bar__sub">INR peer market · escrow protected</p>
            </div>
          </div>

          <nav className="p2p-bar__nav" aria-label="P2P navigation">
            {user ? (
              <>
                <Link to="/p2p/orders" className="p2p-bar__link">
                  Orders
                </Link>
                <Link to="/p2p/my-ads" className="p2p-bar__link">
                  My ads
                </Link>
                <Link to="/p2p/payment-methods" className="p2p-bar__link p2p-bar__link--desktop">
                  Payments
                </Link>
                <Link to="/p2p/my-ads?action=create" className="p2p-primary-btn">
                  <Plus size={14} /> Post ad
                </Link>
              </>
            ) : (
              <>
                <Link to="/login" className="p2p-ghost-btn">
                  Log in
                </Link>
                <Link to="/register" className="p2p-primary-btn">
                  Sign up
                </Link>
              </>
            )}
          </nav>
        </header>

        {/* Split: control dock + offer feed */}
        <div className="p2p-split">
          <aside className="p2p-dock" aria-label="Market controls">
            <p className="p2p-dock__label">You want to</p>
            <div className="p2p-side-toggle" role="tablist" aria-label="Buy or sell">
              <button
                type="button"
                role="tab"
                aria-selected={side === 'buy'}
                className={`p2p-side-toggle__btn${side === 'buy' ? ' is-buy' : ''}`}
                onClick={() => setSide('buy')}
              >
                Buy
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={side === 'sell'}
                className={`p2p-side-toggle__btn${side === 'sell' ? ' is-sell' : ''}`}
                onClick={() => setSide('sell')}
              >
                Sell
              </button>
            </div>

            <p className="p2p-dock__label">Asset</p>
            <div className="p2p-asset-list" role="tablist" aria-label="Asset">
              {ASSETS.map((a) => (
                <button
                  key={a}
                  type="button"
                  role="tab"
                  aria-selected={asset === a}
                  className={`p2p-asset-list__btn${asset === a ? ' is-on' : ''}`}
                  onClick={() => setAsset(a)}
                >
                  <span>{a}</span>
                  <span className="p2p-asset-list__fiat">INR</span>
                </button>
              ))}
            </div>

            <p className="p2p-dock__label">Payment</p>
            <div className="p2p-pm-grid">
              <button
                type="button"
                className={`p2p-pm-chip${!pm ? ' is-on' : ''}`}
                onClick={() => setPm('')}
              >
                All
              </button>
              {PMS.map((p) => (
                <button
                  key={p}
                  type="button"
                  className={`p2p-pm-chip${pm === p ? ' is-on' : ''}`}
                  onClick={() => setPm(p === pm ? '' : p)}
                >
                  {p}
                </button>
              ))}
            </div>

            <label className="p2p-dock-field">
              <span className="p2p-dock__label">Amount (₹)</span>
              <span className="p2p-dock-field__wrap">
                <IndianRupee size={14} aria-hidden />
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') load();
                  }}
                  placeholder="Filter by order size"
                  className="p2p-dock-field__input"
                />
              </span>
            </label>

            <button
              type="button"
              onClick={load}
              disabled={loading}
              className="p2p-primary-btn p2p-dock__apply"
            >
              {loading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Search size={15} />
              )}
              Find offers
            </button>

            <div className="p2p-dock__aside">
              <div className="p2p-dock__stat">
                <span>Market</span>
                <strong>
                  {side === 'buy' ? 'Buy' : 'Sell'} {asset}/INR
                </strong>
              </div>
              <div className="p2p-dock__stat">
                <span>{side === 'buy' ? 'Best ask' : 'Best bid'}</span>
                <strong className="tabular-nums">
                  {bestPrice != null ? `₹${fmtINR(bestPrice)}` : '—'}
                </strong>
              </div>
              <p className="p2p-dock__note">
                Funds stay in escrow until the buyer confirms payment. Settles via bank / UPI.
              </p>
              {user ? (
                <div className="p2p-dock__links">
                  <Link to="/p2p/merchant">
                    <ShieldCheck size={12} /> Merchant
                  </Link>
                  <Link to="/p2p/payment-methods">
                    <Banknote size={12} /> Methods
                  </Link>
                </div>
              ) : (
                <p className="p2p-dock__note">Sign in to post ads and open orders.</p>
              )}
            </div>
          </aside>

          <section className="p2p-feed" aria-label="P2P offers">
            <div className="p2p-feed__head">
              <div className="min-w-0">
                <h2 className="p2p-feed__title">
                  {side === 'buy' ? 'Buy' : 'Sell'} {asset}
                </h2>
                <p className="p2p-feed__meta">
                  {countLabel}
                  {pm ? (
                    <>
                      {' '}
                      · <span>{pm}</span>
                    </>
                  ) : null}
                  {amount ? (
                    <>
                      {' '}
                      · near ₹{fmtINR(amount)}
                    </>
                  ) : null}
                </p>
              </div>
              <button
                type="button"
                onClick={load}
                disabled={loading}
                className="p2p-ghost-btn p2p-feed__refresh"
                title="Refresh"
              >
                <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>

            {error ? (
              <div className="p2p-market__error" role="alert">
                <AlertCircle size={15} />
                <span>{error}</span>
              </div>
            ) : null}

            {loading && (!ads || ads.length === 0) ? (
              <div className="p2p-feed__state">
                <Loader2 size={22} className="animate-spin text-[#FE6C02]" />
                <p>Loading live offers…</p>
              </div>
            ) : ads === null ? null : ads.length === 0 ? (
              <div className="p2p-feed__state">
                <Store size={28} className="opacity-40 text-[color:var(--ibo-muted)]" />
                <p className="p2p-feed__state-title">
                  No {side} ads for {asset}
                </p>
                <p className="p2p-feed__state-sub">
                  Try another payment method, amount, or post the first ad.
                </p>
                {user ? (
                  <Link to="/p2p/my-ads?action=create" className="p2p-primary-btn mt-2">
                    <Plus size={14} /> Post ad
                  </Link>
                ) : null}
              </div>
            ) : (
              <div className={`p2p-feed__grid${loading ? ' is-loading' : ''}`}>
                {ads.map((ad) => (
                  <OfferCard key={ad.ad_id} ad={ad} side={side} />
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
