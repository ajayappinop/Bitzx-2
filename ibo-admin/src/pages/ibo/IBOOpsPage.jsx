import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard, DollarSign, Layers, ArrowLeftRight,
  Wallet, ArrowDownUp, Users, BarChart3,
} from 'lucide-react';

import IBODashboardTab   from './tabs/IBODashboardTab';
import IBOPriceTab       from './tabs/IBOPriceTab';
import IBOLiquidityTab   from './tabs/IBOLiquidityTab';
import IBOPairsTab       from './tabs/IBOPairsTab';
import IBOWalletSupplyTab from './tabs/IBOWalletSupplyTab';
import IBODepositsTab    from './tabs/IBODepositsTab';
import IBOHoldingsTab    from './tabs/IBOHoldingsTab';
import IBOAnalyticsTab   from './tabs/IBOAnalyticsTab';

const IBO_LOGO = '/ibo-logo.png';

/**
 * IBO Trading Ecosystem — 8-tab admin workspace.
 *
 * Tab routing via `?tab=` URL param so deep-links and refreshes work.
 */
export default function IBOOpsPage() {
  const [params, setParams] = useSearchParams();

  const TABS = useMemo(() => [
    { id: 'dashboard',    label: 'Dashboard',            icon: LayoutDashboard,  Component: IBODashboardTab   },
    { id: 'price',        label: 'Price Management',     icon: DollarSign,       Component: IBOPriceTab       },
    { id: 'liquidity',    label: 'Liquidity',            icon: Layers,           Component: IBOLiquidityTab   },
    { id: 'pairs',        label: 'Trading Pairs',        icon: ArrowLeftRight,   Component: IBOPairsTab       },
    { id: 'supply',       label: 'Wallet & Supply',      icon: Wallet,           Component: IBOWalletSupplyTab },
    { id: 'deposits',     label: 'Deposits / Withdrawals', icon: ArrowDownUp,    Component: IBODepositsTab    },
    { id: 'holdings',     label: 'User Holdings',        icon: Users,            Component: IBOHoldingsTab    },
    { id: 'analytics',    label: 'Analytics & Logs',     icon: BarChart3,        Component: IBOAnalyticsTab   },
  ], []);

  const requested = params.get('tab') || 'dashboard';
  const active    = TABS.find((t) => t.id === requested) || TABS[0];

  const setTab = (id) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      {/* <div className="flex items-center gap-3">
        <img src={IBO_LOGO} alt="IBO" className="w-8 h-8 rounded-full object-contain" />
        <div> */}
          {/* <h1 className="text-xl font-bold text-white flex items-center gap-2">
            IBO Trading Ecosystem
          </h1>
          <p className="text-[12px] text-white/50">
            Manage IBO-as-quote pairs, pricing, liquidity, and user holdings.
          </p> */}
        {/* </div> */}
      {/* </div> */}

      {/* Tab bar */}
      <div className="flex items-center gap-0 border-b border-white/10 overflow-x-auto scrollbar-hide">
        {TABS.map((t) => {
          const Icon     = t.icon;
          const isActive = active?.id === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`px-4 py-2.5 inline-flex items-center gap-2 text-[13px] font-semibold whitespace-nowrap transition-colors flex-shrink-0 ${
                isActive
                  ? 'text-gold-light border-b-2 border-gold-light'
                  : 'text-white/50 hover:text-white border-b-2 border-transparent'
              }`}
            >
              <Icon size={13} />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* Active tab content */}
      {active ? <active.Component /> : (
        <div className="text-white/45 text-sm py-12 text-center">No tab selected.</div>
      )}
    </div>
  );
}
