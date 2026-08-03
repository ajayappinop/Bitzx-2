import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Activity, Sliders, ArrowLeftRight, TrendingUp,
} from 'lucide-react';
import { hasPermission } from '@/lib/adminAccess';
import { useAdminAuth } from '@/context/AdminAuthContext';
import FuturesOverviewPage from './FuturesOverviewPage';
import FuturesSymbolsPage  from './FuturesSymbolsPage';
import FuturesFundingPage  from './FuturesFundingPage';

/**
 * Futures Operations workspace — engine-side controls and configuration.
 *
 * Tabs:
 *   - overview : metrics, kill-switches, fee/leverage/funding parameters
 *   - symbols  : per-symbol tick/lot/min-max/leverage cap and listing toggles
 *   - funding  : recent rates, settlement history, manual settlement
 *
 * Selected tab is persisted in `?tab=` so deep-links and refreshes work.
 */
export default function FuturesOpsPage() {
  const { admin } = useAdminAuth();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const TABS = useMemo(() => [
    {
      id: 'overview',
      label: 'Overview & Controls',
      icon: TrendingUp,
      // Always allowed if the user can reach this page (view_orders).
      visible: true,
      Component: FuturesOverviewPage,
    },
    {
      id: 'symbols',
      label: 'Symbols & Tiers',
      icon: Sliders,
      visible: hasPermission(admin, 'view_markets'),
      Component: FuturesSymbolsPage,
    },
    {
      id: 'funding',
      label: 'Funding',
      icon: ArrowLeftRight,
      visible: hasPermission(admin, 'view_finance'),
      Component: FuturesFundingPage,
    },
  ], [admin]);

  const visible = TABS.filter((t) => t.visible);
  const requested = params.get('tab') || 'overview';
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
            <Activity size={20} /> Futures Operations
          </h1>
          <p className="text-[12px] text-white/50">
            Engine controls, listed symbols and funding settlements.
          </p>
        </div>
        <button
          onClick={() => navigate('/futures/activity')}
          className="text-[12px] text-gold-light hover:underline"
        >
          Go to Activity →
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
