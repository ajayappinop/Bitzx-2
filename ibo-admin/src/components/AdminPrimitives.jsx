export function AdminPageHeader({
  icon: Icon,
  iconClassName = 'text-[#FE6C02]',
  title,
  subtitle,
  badge,
  actions,
  actionsWithBadge = false,
}) {
  return (
    <div className="admin-hero">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <h1 className="admin-title inline-flex items-center gap-2">
            {Icon ? <Icon className={iconClassName} size={28} /> : null}
            {title}
          </h1>
          {subtitle ? <p className="admin-subtitle">{subtitle}</p> : null}
          {actionsWithBadge ? (
            (badge || actions) ? (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {badge ? (
                  <span className="admin-pill border-[#FE6C02]/30 bg-[#FE6C02]/10 text-[#FE9D55]">
                    {badge}
                  </span>
                ) : null}
                {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
              </div>
            ) : null
          ) : (
            badge ? (
              <span className="admin-pill mt-3 border-[#FE6C02]/30 bg-[#FE6C02]/10 text-[#FE9D55]">
                {badge}
              </span>
            ) : null
          )}
        </div>
        {!actionsWithBadge && actions ? (
          <div className="flex items-center gap-2 flex-wrap">{actions}</div>
        ) : null}
      </div>
    </div>
  );
}

export function GradientStatCard({ label, value, hint, tone = 'orange' }) {
  const tones = {
    orange: 'from-[#FE6C02]/20 to-transparent border-[#FE6C02]/30',
    cyan: 'from-[#FE6C02]/20 to-transparent border-[#FE6C02]/30',
    emerald: 'from-[#00A876]/20 to-transparent border-[#00A876]/30',
    violet: 'from-[#FE6C02]/15 to-transparent border-[#B44D01]/30',
    amber: 'from-[#FE9D55]/20 to-transparent border-[#FE6C02]/30',
    rose: 'from-[#EB5454]/20 to-transparent border-[#EB5454]/30',
  };
  return (
    <div className={`admin-kpi-card bg-gradient-to-br ${tones[tone] || tones.orange}`}>
      <p className="text-sm font-semibold text-white/90">{label}</p>
      <p className="admin-kpi-value">{value}</p>
      {hint ? <p className="text-sm text-white/70 mt-1">{hint}</p> : null}
    </div>
  );
}

export function AdminPanel({ title, subtitle, right, children, className = '' }) {
  return (
    <section className={`admin-section ${className}`}>
      {(title || right || subtitle) ? (
        <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 border-b border-surface-border/70">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div>
              {title ? <h2 className="admin-section-title !mb-1">{title}</h2> : null}
              {subtitle ? <p className="text-base text-white/75 leading-relaxed">{subtitle}</p> : null}
            </div>
            {right ? <div>{right}</div> : null}
          </div>
        </div>
      ) : null}
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function StatusBadge({ tone = 'neutral', children, compact = false }) {
  const map = {
    success: 'border-emerald-500/35 bg-emerald-500/15 text-emerald-200',
    danger: 'border-rose-500/35 bg-rose-500/15 text-rose-200',
    warning: 'border-gold/35 bg-gold/15 text-[#FE9D55]',
    info: 'border-[#FE6C02]/35 bg-[#FE6C02]/15 text-[#FE9D55]',
    violet: 'border-[#B44D01]/35 bg-[#FE6C02]/10 text-[#FE9D55]',
    neutral: 'border-surface-border bg-white/10 text-white/85',
  };
  const cls = compact
    ? `inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-semibold leading-tight ${map[tone] || map.neutral}`
    : `admin-pill ${map[tone] || map.neutral}`;
  return <span className={cls}>{children}</span>;
}

export function FilterBar({ children, className = '' }) {
  return <div className={`admin-filter-bar ${className}`}>{children}</div>;
}

export function AdminDataTable({ children, className = '' }) {
  return (
    <div className={`admin-section overflow-hidden ${className}`}>
      <div className="adm-table-x scrollbar-thin">
        <table className="admin-data-table">{children}</table>
      </div>
    </div>
  );
}
