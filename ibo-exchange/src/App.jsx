import React, { useEffect, useState } from 'react';
import { Routes, Route, Navigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { exchangeApiOrigin } from '@/lib/apiBase';
import ComingSoonPage from '@/pages/ComingSoonPage';
import Navbar        from '@/components/layout/Navbar';
import ImpersonationBanner from '@/components/layout/ImpersonationBanner';
import FeaturesPausedBanner from '@/components/layout/FeaturesPausedBanner';
import SignupBonusKycPrompt from '@/components/wallet/SignupBonusKycPrompt';
import Footer        from '@/components/layout/Footer';
import LandingPage   from '@/pages/LandingPage';
import MarketsPage   from '@/pages/MarketsPage';
import TradePage     from '@/pages/TradePage';
import LoginPage     from '@/pages/LoginPage';
import RegisterPage  from '@/pages/RegisterPage';
import EmailVerificationPage from '@/pages/EmailVerificationPage';
import ForgotPasswordPage        from '@/pages/ForgotPasswordPage';
import ResetPasswordPage          from '@/pages/ResetPasswordPage';
import DashboardPage from '@/pages/DashboardPage';
import WalletPage    from '@/pages/WalletPage';
import InrDepositPage from '@/pages/InrDepositPage';
import InrWithdrawPage from '@/pages/InrWithdrawPage';
import ProfilePage      from '@/pages/ProfilePage';
import KYCPage          from '@/pages/KYCPage';
import QuickTradePage   from '@/pages/QuickTradePage';
import PnLAnalyticsPage from '@/pages/PnLAnalyticsPage';
import SupportDisputesPage from '@/pages/SupportDisputesPage';
import FuturesTradePage from '@/pages/FuturesTradePage';
import OptionsTradePage from '@/pages/OptionsTradePage';
import SettingsPage          from '@/pages/SettingsPage';
import P2PMarketplacePage    from '@/pages/p2p/P2PMarketplacePage';
import P2PAdDetailPage       from '@/pages/p2p/P2PAdDetailPage';
import P2POrderDetailPage    from '@/pages/p2p/P2POrderDetailPage';
import P2POrdersPage         from '@/pages/p2p/P2POrdersPage';
import P2PMyAdsPage          from '@/pages/p2p/P2PMyAdsPage';
import P2PPaymentMethodsPage from '@/pages/p2p/P2PPaymentMethodsPage';
import P2PMerchantPage       from '@/pages/p2p/P2PMerchantPage';
import IBOMarketsPage        from '@/pages/IBOMarketsPage';
import IBOMarket             from '@/pages/IBOMarket';
import ListCoinPage          from '@/pages/ListCoinPage';
import PrivacyPolicyPage     from '@/pages/PrivacyPolicyPage';
import TermsPage             from '@/pages/TermsPage';
import ReferAndEarnPage      from '@/pages/ReferAndEarnPage';
import { captureReferralCodeFromUrl } from '@/lib/referral';

/** Surfaces render/import errors instead of a blank screen on the options route. */
class OptionsRouteErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }

  static getDerivedStateFromError(err) {
    return { err };
  }

  render() {
    if (this.state.err) {
      return (
        <div className="min-h-[50vh] flex flex-col items-center justify-center gap-4 px-6 bg-[#0a0b0d] text-zinc-200">
          <p className="text-lg font-bold text-rose-300">Options page failed to load</p>
          <pre className="max-w-2xl w-full text-xs text-left whitespace-pre-wrap break-words bg-black/40 border border-white/10 rounded-lg p-4 text-rose-200/90">
            {String(this.state.err?.message || this.state.err)}
          </pre>
          <a href="/markets" className="text-gold-light font-semibold underline">Back to markets</a>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── Protected route — redirects to /login if not authenticated ────────────────
function ProtectedRoute({ children }) {
  const { user, authLoading } = useAuth();

  if (authLoading) {
    return (
      <div className="ibo-page flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return user ? children : <Navigate to="/login" replace />;
}

// ── Main layout (Navbar + optional Footer) ───────────────────────────────────
function Layout() {
  const { pathname } = useLocation();
  const isTrade  = pathname.startsWith('/trade') || pathname.startsWith('/futures') || pathname.startsWith('/options');
  const isHome   = pathname === '/';

  return (
    <div className="relative h-[100dvh] max-h-[100dvh] flex flex-col overflow-hidden">
      {isHome && (
        <div className="fixed inset-0 pointer-events-none" style={{ zIndex: 0 }}>
          <div className="absolute inset-0 bg-[color:var(--ibo-bg)]" />
        </div>
      )}

      {/* Single scroll root so sticky navbar works on every page */}
      <div
        data-ibo-scroll-root
        className={`relative flex flex-col flex-1 min-h-0 overflow-x-hidden ${
          isTrade ? 'overflow-hidden' : 'overflow-y-auto'
        }`}
        style={{ zIndex: 3 }}
      >
        <Navbar />
        <ImpersonationBanner />
        <FeaturesPausedBanner />
        <SignupBonusKycPrompt />
        <main className={`flex w-full min-w-0 flex-col flex-1 ${isTrade ? 'min-h-0 overflow-hidden' : 'shrink-0'}`}>
          <Outlet />
        </main>
        {!isTrade && <Footer />}
      </div>
    </div>
  );
}

// ── Launch-status gate ────────────────────────────────────────────────────────
const API_ORIGIN = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const POLL_INTERVAL_MS = 30_000;

function useLaunchStatus() {
  const [status, setStatus] = useState({ checked: false, comingSoon: false, message: '', launchDate: '' });

  useEffect(() => {
    let cancelled = false;

    async function fetch_status() {
      const ctrl = new AbortController();
      const timeout = window.setTimeout(() => ctrl.abort(), 8000);
      try {
        const res = await fetch(`${API_ORIGIN}/api/platform/launch-status`, {
          cache: 'no-store',
          signal: ctrl.signal,
        });
        if (!res.ok) {
          if (!cancelled) setStatus(s => ({ ...s, checked: true, comingSoon: false }));
          return;
        }
        const data = await res.json();
        if (!cancelled) {
          setStatus({
            checked:     true,
            comingSoon:  !!data.coming_soon,
            message:     data.message || '',
            launchDate:  data.launch_date || '',
          });
        }
      } catch {
        if (!cancelled) setStatus(s => ({ ...s, checked: true, comingSoon: false }));
      } finally {
        window.clearTimeout(timeout);
      }
    }

    fetch_status();
    const id = setInterval(fetch_status, POLL_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  return status;
}

// ── App ───────────────────────────────────────────────────────────────────────
export default function App() {
  const launch = useLaunchStatus();

  // Capture ?ref=<code> from any entry point (landing, direct register link,
  // shared trade page, etc.) so it survives to whichever signup flow the
  // user eventually completes.
  useEffect(() => {
    captureReferralCodeFromUrl(window.location.search);
  }, []);

  // While the status hasn't been fetched yet, show a minimal loading indicator
  // so we don't flash the full UI before potentially redirecting to Coming Soon.
  if (!launch.checked) {
    return (
      <div className="min-h-screen bg-[color:var(--ibo-bg)] flex flex-col items-center justify-center gap-4 px-6">
        <div className="w-10 h-10 border-2 border-[#0EA4AB] border-t-transparent rounded-full animate-spin" />
        <p className="text-sm text-[color:var(--ibo-ink-secondary)]">Loading IBO Exchange…</p>
      </div>
    );
  }

  // Coming Soon gate — shows ONLY the coming soon page when enabled.
  if (launch.comingSoon) {
    return <ComingSoonPage message={launch.message} launchDate={launch.launchDate} />;
  }

  return (
    <Routes>
      <Route path="/login"         element={<LoginPage />} />
      <Route path="/register"      element={<RegisterPage />} />
      <Route path="/verify-mobile" element={<Navigate to="/register" replace />} />
      <Route path="/verify-email"  element={<EmailVerificationPage />} />
      <Route path="/forgot-password" element={<ForgotPasswordPage />} />
      <Route path="/reset-password"  element={<ResetPasswordPage />} />
      <Route path="/reset-password/:token" element={<ResetPasswordPage />} />
      <Route path="/privacy-policy"  element={<PrivacyPolicyPage />} />
      <Route path="/terms-of-service" element={<TermsPage />} />

      <Route element={<Layout />}>
        <Route path="/"              element={<LandingPage />} />
        <Route path="/markets"       element={<MarketsPage />} />
        <Route path="/list-coin"     element={<ListCoinPage />} />
        <Route path="/quick-trade"   element={<QuickTradePage />} />
        <Route path="/trade"         element={<TradePage />} />
        <Route path="/trade/:symbol" element={<TradePage />} />
        <Route path="/futures/:symbol?" element={<FuturesTradePage />} />
        <Route path="/options"           element={<Navigate to="/options/BTCUSDT" replace />} />
        <Route
          path="/options/:underlying"
          element={
            <OptionsRouteErrorBoundary>
              <OptionsTradePage />
            </OptionsRouteErrorBoundary>
          }
        />

        <Route path="/dashboard" element={
          <ProtectedRoute><DashboardPage /></ProtectedRoute>
        } />
        <Route path="/wallet" element={
          <ProtectedRoute><WalletPage /></ProtectedRoute>
        } />
        <Route path="/wallet/deposit/inr" element={
          <ProtectedRoute><InrDepositPage /></ProtectedRoute>
        } />
        <Route path="/wallet/withdraw/inr" element={
          <ProtectedRoute><InrWithdrawPage /></ProtectedRoute>
        } />
        <Route path="/wallet/withdrawals/inr" element={
          <Navigate to="/wallet?tab=history&inr=withdraw" replace />
        } />
        <Route path="/wallet/deposits" element={<Navigate to="/wallet?tab=ledger" replace />} />
        <Route path="/portfolio" element={
          <ProtectedRoute><PnLAnalyticsPage /></ProtectedRoute>
        } />
        <Route path="/profile" element={
          <ProtectedRoute><ProfilePage /></ProtectedRoute>
        } />
        <Route path="/refer-earn" element={
          <ProtectedRoute><ReferAndEarnPage /></ProtectedRoute>
        } />
        <Route path="/kyc" element={
          <ProtectedRoute><KYCPage /></ProtectedRoute>
        } />
        <Route path="/support-disputes" element={
          <ProtectedRoute><SupportDisputesPage /></ProtectedRoute>
        } />
        <Route path="/settings" element={
          <ProtectedRoute><SettingsPage /></ProtectedRoute>
        } />

        {/* ── IBO Markets ──────────────────────────────────────────────── */}
        <Route path="/ibo-markets" element={<IBOMarketsPage />} />
        <Route path="/ibo-market" element={<IBOMarket />} />

        {/* ── P2P Trading ──────────────────────────────────────────────── */}
        <Route path="/p2p"                  element={<P2PMarketplacePage />} />
        <Route path="/p2p/ads/:adId"        element={<P2PAdDetailPage />} />
        <Route path="/p2p/orders"           element={<ProtectedRoute><P2POrdersPage /></ProtectedRoute>} />
        <Route path="/p2p/orders/:orderId"  element={<ProtectedRoute><P2POrderDetailPage /></ProtectedRoute>} />
        <Route path="/p2p/my-ads"           element={<ProtectedRoute><P2PMyAdsPage /></ProtectedRoute>} />
        <Route path="/p2p/payment-methods"  element={<ProtectedRoute><P2PPaymentMethodsPage /></ProtectedRoute>} />
        <Route path="/p2p/merchant"         element={<ProtectedRoute><P2PMerchantPage /></ProtectedRoute>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
