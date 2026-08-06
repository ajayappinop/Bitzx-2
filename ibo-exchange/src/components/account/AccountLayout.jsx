import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import {
  ACCOUNT_NAV_ITEMS,
  ACCOUNT_SECTION_TITLES,
  isAccountPath,
} from '@/lib/accountNav';

const ACCOUNT_NAV_IDS = new Set(ACCOUNT_NAV_ITEMS.map((item) => item.id));

function sectionIdFromPath(pathname) {
  if (!isAccountPath(pathname)) return 'positions';
  const part = pathname.replace(/^\/account\/?/, '').split('/')[0];
  // Legacy trading routes now live under Positions tabs
  if (part === 'open-orders' || part === 'order-history' || part === 'trade-history') {
    return 'positions';
  }
  // Transfer / invoices live under Activity (transaction-logs) tabs
  if (part === 'transfer' || part === 'invoices') {
    return 'transaction-logs';
  }
  return part || 'positions';
}

export default function AccountLayout() {
  const { pathname } = useLocation();
  const { user } = useAuth();
  const section = sectionIdFromPath(pathname);
  const title = ACCOUNT_SECTION_TITLES[section] || 'Account';
  // Only show left rail for sections listed in the sidebar tabs
  const showSidebar = ACCOUNT_NAV_IDS.has(section);

  return (
    <div className={`delta-account${showSidebar ? '' : ' delta-account--no-rail'}`}>
      {showSidebar ? (
        <aside className="delta-account__rail" aria-label="Account navigation">
          <nav className="delta-account__nav">
            <ul className="delta-account__list">
              {ACCOUNT_NAV_ITEMS.map((item) => (
                <li key={item.id}>
                  <NavLink
                    to={item.to}
                    end
                    className={({ isActive }) =>
                      `delta-account__link${isActive || section === item.id ? ' is-active' : ''}`
                    }
                  >
                    {item.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
        </aside>
      ) : null}

      <section className="delta-account__main" aria-label={title}>
        <header className="delta-account__page-head">
          <h1 className="delta-account__page-title">{title}</h1>
          {user?.email ? (
            <p className="delta-account__page-meta" title={user.email}>
              {user.email}
            </p>
          ) : null}
        </header>
        <div className="delta-account__content">
          <Outlet />
        </div>
      </section>
    </div>
  );
}
