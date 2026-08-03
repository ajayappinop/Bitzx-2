import { Routes, Route, Navigate } from 'react-router-dom';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission, hasAnyPermission } from '@/lib/adminAccess';
import AdminLayout from '@/components/AdminLayout';
import LoginPage from '@/pages/LoginPage';
import DashboardPage from '@/pages/DashboardPage';
import UsersPage from '@/pages/UsersPage';
import UserDetailPage from '@/pages/UserDetailPage';
import ReferralTreePage from '@/pages/ReferralTreePage';
// Phase 4 — on-chain deposit pipeline (poller + crediter). Phase 5 — admin
// deposit-events queue + manual credit; withdrawals queue remains WithdrawalsPage.
import AuditPage from '@/pages/AuditPage';
import KycQueuePage from '@/pages/KycQueuePage';
import SurveillancePage from '@/pages/SurveillancePage';
import SecurityPage from '@/pages/SecurityPage';
import SystemLogsPage from '@/pages/SystemLogsPage';
import CompliancePage from '@/pages/CompliancePage';
import FinancePage from '@/pages/FinancePage';
import TreasuryPage from '@/pages/TreasuryPage';
import TreasuryOmnibusWalletsPage from '@/pages/TreasuryOmnibusWalletsPage';
import AdminWalletPage from '@/pages/AdminWalletPage';
import TreasuryTransferPage from '@/pages/TreasuryTransferPage';
import FundsHubPage from '@/pages/FundsHubPage';
import HedgerPage from '@/pages/HedgerPage';
import AlertsPage from '@/pages/AlertsPage';
import SettingsPage from '@/pages/SettingsPage';
import MobileAppPage from '@/pages/MobileAppPage';
import LandingPromoPage from '@/pages/LandingPromoPage';
import AppHomeBannersPage from '@/pages/AppHomeBannersPage';
import MarketsPage from '@/pages/MarketsPage';
import AnalysisPage from '@/pages/AnalysisPage';
import AdminCreatePage from '@/pages/AdminCreatePage';
import WalletAdjustmentsPage from '@/pages/WalletAdjustmentsPage';
import LedgerPage from '@/pages/LedgerPage';
import WithdrawalsPage from '@/pages/WithdrawalsPage';
import DepositEventsPage from '@/pages/DepositEventsPage';
import InrDepositsPage from '@/pages/inr/InrDepositsPage';
import InrWithdrawalsPage from '@/pages/inr/InrWithdrawalsPage';
import InrSettingsPage from '@/pages/inr/InrSettingsPage';
import SignzySettingsPage from '@/pages/SignzySettingsPage';
import LeaderboardPage from '@/pages/LeaderboardPage';
import TradingWorkspacePage from '@/pages/TradingWorkspacePage';
import TradingActivityPage from '@/pages/TradingActivityPage';
import SupportDisputesPage from '@/pages/SupportDisputesPage';
import LiquidityOpsPage from '@/pages/LiquidityOpsPage';
import FuturesOpsPage      from '@/pages/FuturesOpsPage';
import FuturesActivityPage from '@/pages/FuturesActivityPage';
import OptionsOpsPage        from '@/pages/OptionsOpsPage';
import P2POpsPage            from '@/pages/p2p/P2POpsPage';
import IBOOpsPage            from '@/pages/ibo/IBOOpsPage';
import TokenListingsPage     from '@/pages/TokenListingsPage';
import MarketCatalogPage     from '@/pages/MarketCatalogPage';

function Protected({ children }) {
  const { admin, loading } = useAdminAuth();
  if (loading) {
    return (
      <div className="min-h-screen bg-surface-dark flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!admin) return <Navigate to="/login" replace />;
  return children;
}

function RequirePermission({ permission, anyOf, children }) {
  const { admin } = useAdminAuth();
  if (anyOf?.length) {
    if (hasAnyPermission(admin, anyOf)) return children;
    return <Navigate to="/" replace />;
  }
  if (hasPermission(admin, permission)) return children;
  return <Navigate to="/" replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <Protected>
            <AdminLayout />
          </Protected>
        }
      >
        <Route path="/" element={<DashboardPage />} />
        <Route path="/users" element={<RequirePermission permission="view_users"><UsersPage /></RequirePermission>} />
        <Route path="/users/:uid" element={<RequirePermission permission="view_users"><UserDetailPage /></RequirePermission>} />
        <Route path="/referrals" element={<RequirePermission permission="view_users"><ReferralTreePage /></RequirePermission>} />
        <Route path="/kyc" element={<RequirePermission permission="view_kyc"><KycQueuePage /></RequirePermission>} />
        <Route path="/trading" element={<RequirePermission permission="view_orders"><TradingWorkspacePage /></RequirePermission>} />
        <Route path="/trading-activity" element={<RequirePermission permission="view_trades"><TradingActivityPage /></RequirePermission>} />
        <Route path="/orders" element={<Navigate to="/trading?tab=orders" replace />} />
        <Route path="/surveillance" element={<RequirePermission permission="run_surveillance"><SurveillancePage /></RequirePermission>} />
        <Route path="/security" element={<RequirePermission permission="view_security"><SecurityPage /></RequirePermission>} />
        <Route path="/system-logs" element={<RequirePermission permission="view_system_logs"><SystemLogsPage /></RequirePermission>} />
        <Route path="/aml" element={<RequirePermission permission="view_compliance"><CompliancePage mode="aml" /></RequirePermission>} />
        <Route path="/fiu" element={<RequirePermission permission="view_compliance"><CompliancePage mode="fiu" /></RequirePermission>} />
        <Route path="/compliance" element={<Navigate to="/aml" replace />} />
        <Route path="/finance" element={<RequirePermission permission="view_finance"><FinancePage /></RequirePermission>} />
        <Route path="/treasury" element={<RequirePermission permission="view_treasury"><TreasuryPage /></RequirePermission>} />
        <Route path="/admin-wallet" element={<RequirePermission permission="view_treasury"><AdminWalletPage /></RequirePermission>} />
        <Route path="/funds" element={<RequirePermission permission="view_withdrawals"><FundsHubPage /></RequirePermission>} />
        <Route path="/treasury-transfer" element={<RequirePermission permission="view_treasury"><TreasuryTransferPage /></RequirePermission>} />
        <Route path="/treasury-omnibus" element={<RequirePermission permission="view_treasury"><TreasuryOmnibusWalletsPage /></RequirePermission>} />
        <Route path="/hedger" element={<RequirePermission permission="view_hedger"><HedgerPage /></RequirePermission>} />
        <Route path="/liquidity-ops" element={<RequirePermission permission="view_hedger"><LiquidityOpsPage /></RequirePermission>} />
        <Route path="/alerts" element={<RequirePermission permission="view_alerts"><AlertsPage /></RequirePermission>} />
        <Route path="/support-disputes" element={<RequirePermission permission="view_support"><SupportDisputesPage /></RequirePermission>} />
        <Route path="/markets" element={<RequirePermission permission="view_markets"><MarketsPage /></RequirePermission>} />
        <Route path="/token-listings" element={<RequirePermission permission="view_listings"><TokenListingsPage /></RequirePermission>} />
        <Route path="/market-catalog" element={<RequirePermission permission="view_listings"><MarketCatalogPage /></RequirePermission>} />
        <Route path="/analysis" element={<RequirePermission permission="view_analytics"><AnalysisPage /></RequirePermission>} />
        <Route path="/live-positions" element={<Navigate to="/trading?tab=positions" replace />} />
        <Route path="/leaderboard" element={<RequirePermission permission="view_analytics"><LeaderboardPage /></RequirePermission>} />
        <Route path="/wallet-adjustments" element={<RequirePermission anyOf={['manage_users', 'adjust_wallets']}><WalletAdjustmentsPage /></RequirePermission>} />
        <Route path="/ledger" element={<RequirePermission permission="view_ledger"><LedgerPage /></RequirePermission>} />
        <Route path="/withdrawals" element={<RequirePermission permission="view_withdrawals"><WithdrawalsPage /></RequirePermission>} />
        <Route path="/deposit-events" element={<RequirePermission permission="view_withdrawals"><DepositEventsPage /></RequirePermission>} />
        <Route path="/inr-deposits" element={<RequirePermission permission="view_withdrawals"><InrDepositsPage /></RequirePermission>} />
        <Route path="/inr-withdrawals" element={<RequirePermission permission="view_withdrawals"><InrWithdrawalsPage /></RequirePermission>} />
        <Route path="/inr-settings" element={<RequirePermission permission="manage_settings"><InrSettingsPage /></RequirePermission>} />
        <Route path="/signzy-settings" element={<RequirePermission permission="manage_settings"><SignzySettingsPage /></RequirePermission>} />
        <Route path="/deposits" element={<Navigate to="/deposit-events" replace />} />
        <Route path="/audit" element={<RequirePermission permission="view_system_logs"><AuditPage /></RequirePermission>} />
        <Route path="/settings" element={<RequirePermission permission="view_settings"><SettingsPage /></RequirePermission>} />
        <Route path="/settings/mobile-app" element={<RequirePermission permission="view_settings"><MobileAppPage /></RequirePermission>} />
        <Route path="/settings/landing-promo" element={<RequirePermission permission="view_settings"><LandingPromoPage /></RequirePermission>} />
        <Route path="/settings/app-home-banners" element={<RequirePermission permission="view_settings"><AppHomeBannersPage /></RequirePermission>} />
        <Route path="/settings/admin-create" element={<RequirePermission permission="manage_admins"><AdminCreatePage /></RequirePermission>} />

        {/* ── Futures admin module ──────────────────────────────────── */}
        {/* Two screens with internal tabs. /futures = engine ops, */}
        {/* /futures/activity = user activity (positions/orders/trades/liq/wallets). */}
        <Route
          path="/futures"
          element={
            <RequirePermission anyOf={['view_orders', 'view_trades', 'view_finance', 'view_markets']}>
              <FuturesOpsPage />
            </RequirePermission>
          }
        />
        <Route
          path="/futures/activity"
          element={
            <RequirePermission anyOf={['view_orders', 'view_trades', 'view_finance', 'adjust_wallets']}>
              <FuturesActivityPage />
            </RequirePermission>
          }
        />
        {/* Legacy deep-links from the previous flat layout — bounce them */}
        {/* into the right tab so existing bookmarks keep working. */}
        <Route path="/futures/positions"    element={<Navigate to="/futures/activity?tab=positions"    replace />} />
        <Route path="/futures/orders"       element={<Navigate to="/futures/activity?tab=orders"       replace />} />
        <Route path="/futures/trades"       element={<Navigate to="/futures/activity?tab=trades"       replace />} />
        <Route path="/futures/liquidations" element={<Navigate to="/futures/activity?tab=liquidations" replace />} />
        <Route path="/futures/wallets"      element={<Navigate to="/futures/activity?tab=wallets"      replace />} />
        <Route path="/futures/symbols"      element={<Navigate to="/futures?tab=symbols" replace />} />
        <Route path="/futures/funding"      element={<Navigate to="/futures?tab=funding" replace />} />

        <Route
          path="/options"
          element={
            <RequirePermission anyOf={['view_markets', 'view_orders', 'manage_settings']}>
              <OptionsOpsPage />
            </RequirePermission>
          }
        />

        {/* ── P2P admin module ──────────────────────────────────────────── */}
        <Route
          path="/p2p"
          element={
            <RequirePermission anyOf={['view_orders', 'view_support', 'view_users']}>
              <P2POpsPage />
            </RequirePermission>
          }
        />

        {/* ── IBO Trading Ecosystem admin module ───────────────────────── */}
        <Route
          path="/ibo"
          element={
            <RequirePermission anyOf={['view_markets', 'view_orders', 'manage_settings', 'view_finance']}>
              <IBOOpsPage />
            </RequirePermission>
          }
        />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
