export function AdminPageHeader({
  icon: Icon,
  iconClassName = 'text-cyan-300',
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
                  <span className="admin-pill border-cyan-400/30 bg-cyan-500/10 text-cyan-200">
                    {badge}
                  </span>
                ) : null}
                {actions ? <div className="flex items-center gap-2 flex-wrap">{actions}</div> : null}
              </div>
            ) : null
          ) : (
            badge ? (
              <span className="admin-pill mt-3 border-cyan-400/30 bg-cyan-500/10 text-cyan-200">
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

export function GradientStatCard({ label, value, hint, tone = 'cyan' }) {
  const tones = {
    cyan: 'from-[#3B82F6]/20 to-transparent border-[#3B82F6]/30',
    emerald: 'from-[#0ECB81]/20 to-transparent border-[#0ECB81]/30',
    violet: 'from-[#8B5CF6]/20 to-transparent border-[#8B5CF6]/30',
    amber: 'from-[#0EA4AB]/20 to-transparent border-[#0EA4AB]/30',
    rose: 'from-[#F6465D]/20 to-transparent border-[#F6465D]/30',
  };
  return (
    <div className={`admin-kpi-card bg-gradient-to-br ${tones[tone] || tones.cyan}`}>
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
    warning: 'border-gold/35 bg-gold/15 text-gold-light',
    info: 'border-cyan-500/35 bg-cyan-500/15 text-cyan-200',
    violet: 'border-violet-500/35 bg-violet-500/15 text-violet-200',
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
