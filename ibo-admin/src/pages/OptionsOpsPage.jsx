import { useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Activity, Sliders, Layers } from 'lucide-react';
import { hasPermission } from '@/lib/adminAccess';
import { useAdminAuth } from '@/context/AdminAuthContext';
import OptionsOverviewPage from './OptionsOverviewPage';
import OptionsUnderlyingsPage from './OptionsUnderlyingsPage';
import OptionsContractsPage from './OptionsContractsPage';

/** Options admin workspace — controls, underlyings, contracts, fee sink, settlement tools. */
export default function OptionsOpsPage() {
  const { admin } = useAdminAuth();
  const [params, setParams] = useSearchParams();

  const TABS = useMemo(
    () => [
      { id: 'overview', label: 'Overview', icon: Activity, visible: true, Component: OptionsOverviewPage },
      {
        id: 'underlyings',
        label: 'Underlyings',
        icon: Layers,
        visible: hasPermission(admin, 'view_markets'),
        Component: OptionsUnderlyingsPage,
      },
      {
        id: 'contracts',
        label: 'Contracts',
        icon: Sliders,
        visible: hasPermission(admin, 'view_markets'),
        Component: OptionsContractsPage,
      },
    ],
    [admin],
  );

  const visible = TABS.filter((t) => t.visible);
  const requested = params.get('tab') || 'overview';
  const active = visible.find((t) => t.id === requested) || visible[0];
  const Body = active?.Component || OptionsOverviewPage;

  const setTab = (id) => {
    const next = new URLSearchParams(params);
    next.set('tab', id);
    setParams(next, { replace: true });
  };

  return (
    <div className="max-w-[1600px] mx-auto space-y-6 pb-10">
      <header className="space-y-1">
        <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight">Options operations</h1>
        <p className="text-sm text-white/50 max-w-2xl leading-relaxed">
          Platform flags, fee overrides, demo seeding, underlyings, and per-contract listing and settlement.
        </p>
      </header>

      <nav
        className="flex flex-wrap gap-1.5 p-1 rounded-xl bg-black/35 border border-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]"
        aria-label="Options admin sections"
      >
        {visible.map((t) => {
          const Icon = t.icon;
          const isActive = active?.id === t.id;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex-1 min-w-[120px] sm:min-w-[140px] px-3 py-2.5 inline-flex items-center justify-center gap-2 text-xs sm:text-sm font-bold rounded-lg transition-colors border ${
                isActive
                  ? 'bg-gold/15 text-gold-light border-gold/40 shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]'
                  : 'text-white/55 hover:text-white/90 hover:bg-white/[0.06] border-transparent'
              }`}
            >
              <Icon size={16} className={isActive ? 'text-gold-light' : 'text-white/40'} strokeWidth={2} />
              {t.label}
            </button>
          );
        })}
      </nav>

      <section className="min-h-[200px]">
        <Body />
      </section>
    </div>
  );
}
