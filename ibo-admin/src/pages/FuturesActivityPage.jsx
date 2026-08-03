import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, BookText, ReceiptText, Flame, Banknote, BarChart3,
} from 'lucide-react';
import { hasPermission, hasAnyPermission } from '@/lib/adminAccess';
import { useAdminAuth } from '@/context/AdminAuthContext';
import FuturesPositionsPage         from './FuturesPositionsPage';
import FuturesOrdersPage            from './FuturesOrdersPage';
import FuturesTradesPage            from './FuturesTradesPage';
import FuturesLiquidationsPage      from './FuturesLiquidationsPage';
import FuturesWalletAdjustmentsPage from './FuturesWalletAdjustmentsPage';

/**
 * Futures Activity workspace — everything users have done.
 *
 * Tabs:
 *   - positions    : live + closed positions, force close
 *   - orders       : live + historical orders, admin cancel
 *   - trades       : tape (book vs SYSTEM synthetic)
 *   - liquidations : full liquidation history
 *   - wallets      : per-user margin balances + adjustments + ledger
 */
export default function FuturesActivityPage() {
  const { admin } = useAdminAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const TABS = useMemo(() => [
    {
      id: 'positions',
      label: 'Positions',
      icon: BarChart3,
      visible: hasPermission(admin, 'view_orders'),
      Component: FuturesPositionsPage,
    },
    {
      id: 'orders',
      label: 'Orders',
      icon: ReceiptText,
      visible: hasPermission(admin, 'view_orders'),
      Component: FuturesOrdersPage,
    },
    {
      id: 'trades',
      label: 'Trades',
      icon: BookText,
      visible: hasPermission(admin, 'view_trades'),
      Component: FuturesTradesPage,
    },
    {
      id: 'liquidations',
      label: 'Liquidations',
      icon: Flame,
      visible: hasPermission(admin, 'view_orders'),
      Component: FuturesLiquidationsPage,
    },
    {
      id: 'wallets',
      label: 'Wallets',
      icon: Banknote,
      visible: hasAnyPermission(admin, ['adjust_wallets', 'view_finance']),
      Component: FuturesWalletAdjustmentsPage,
    },
  ], [admin]);

  const visible = TABS.filter((t) => t.visible);
  const requested = params.get('tab') || 'positions';
  const active = visible.find((t) => t.id === requested) || visible[0];

  const setTab = (id) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-white flex items-center gap-2">
            <Activity size={20} /> Futures Activity
          </h1>
          <p className="text-[12px] text-white/50">
            Positions, orders, trades, liquidations and wallets.
          </p>
        </div>
        <button
          onClick={() => navigate('/futures')}
          className="text-[12px] text-gold-light hover:underline"
        >
          ← Back to Operations
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-white/10 overflow-x-auto scrollbar-hide">
        {visible.map((t) => {
          const Icon = t.icon;
          const isActive = active?.id === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 inline-flex items-center gap-2 text-sm font-bold whitespace-nowrap transition-colors ${
                isActive
                  ? 'text-gold-light border-b-2 border-gold-light'
                  : 'text-white/55 hover:text-white border-b-2 border-transparent'
              }`}
            >
              <Icon size={14} /> {t.label}
            </button>
          );
        })}
      </div>

      {active ? <active.Component /> : (
        <div className="text-white/45 text-sm py-12 text-center">
          You don't have permission to view any tab on this page.
        </div>
      )}
    </div>
  );
}
