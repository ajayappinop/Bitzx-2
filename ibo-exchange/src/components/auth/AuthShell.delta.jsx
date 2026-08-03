/**
 * PARKED — Delta Exchange–inspired auth UI (temporarily disabled).
 * Not imported by routes. Keep for later; do not delete.
 * Active pages: LoginPage.jsx / RegisterPage.jsx / AuthShell.jsx (classic).
 */
import { Link } from 'react-router-dom';
import { BRAND_LOGO } from '@/lib/brandAssets';
import { SITE_CONFIG } from '@/lib/siteConfig';

const LOGO = BRAND_LOGO;
const TOKEN_URL = import.meta.env.VITE_TOKEN_URL || 'https://ibo.io';

/**
 * Delta-inspired auth chrome â€” dark canvas, centered form, optional side panel.
 * Keeps IBO brand colors (cyan / lime) instead of Delta orange.
 */
export function AuthBrandMark({ className = '' }) {
  return (
    <Link to="/" className={`inline-flex items-center ${className}`}>
      <img
        src={LOGO}
        alt="IBO Exchange"
        className="h-10 sm:h-11 w-auto max-w-[220px] object-contain"
        style={{ background: 'transparent' }}
      />
    </Link>
  );
}

export function AuthSocialRow() {
  return (
    <div>
      <p className="text-center text-[12px] text-zinc-500 mb-3">Continue with</p>
      <div className="grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled
          title="Coming soon"
          className="flex items-center justify-center gap-2 h-11 rounded-xl border border-white/[0.1] bg-white/[0.03] text-sm font-semibold text-zinc-400 cursor-not-allowed opacity-70"
        >
          <GoogleGlyph /> Google
        </button>
        <button
          type="button"
          disabled
          title="Coming soon"
          className="flex items-center justify-center gap-2 h-11 rounded-xl border border-white/[0.1] bg-white/[0.03] text-sm font-semibold text-zinc-400 cursor-not-allowed opacity-70"
        >
          <AppleGlyph /> Apple
        </button>
      </div>
      <div className="flex items-center gap-3 my-5">
        <div className="flex-1 h-px bg-white/[0.08]" />
        <span className="text-[11px] uppercase tracking-wider text-zinc-500">or email</span>
        <div className="flex-1 h-px bg-white/[0.08]" />
      </div>
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden>
      <path fill="#EA4335" d="M12 10.2v3.6h5.1c-.2 1.2-.9 2.2-1.9 2.9l3.1 2.4c1.8-1.7 2.9-4.1 2.9-7 0-.7-.1-1.3-.2-1.9H12z" />
      <path fill="#34A853" d="M5.3 14.3l-.8.6-2.5 1.9C3.6 20 7.5 22.5 12 22.5c2.7 0 5-.9 6.7-2.4l-3.1-2.4c-.9.6-2 .9-3.6.9-2.8 0-5.1-1.9-5.9-4.4z" />
      <path fill="#4A90E2" d="M2 7.2C1.4 8.4 1 9.7 1 11.1c0 1.4.4 2.7 1 3.9l3.3-2.6c-.2-.6-.3-1.2-.3-1.8 0-.6.1-1.2.3-1.8L2 7.2z" />
      <path fill="#FBBC05" d="M12 4.8c1.5 0 2.8.5 3.8 1.5l2.8-2.8C16.9 1.8 14.7 1 12 1 7.5 1 3.6 3.5 2 7.2l3.3 2.5C6.9 6.7 9.2 4.8 12 4.8z" />
    </svg>
  );
}

function AppleGlyph() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M16.4 12.5c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3.1-1.6-1.3-.1-2.5.8-3.2.8-.7 0-1.7-.7-2.9-.7-1.5 0-2.8.9-3.6 2.2-1.5 2.7-.4 6.6 1.1 8.8.7 1.1 1.6 2.3 2.8 2.2 1.1 0 1.5-.7 2.9-.7s1.7.7 2.9.7c1.2 0 2-.9 2.7-2 .8-1.2 1.2-2.3 1.2-2.4-.1 0-2.3-.9-2.3-3.5zM14.1 6.4c.6-.8 1.1-1.8.9-2.9-1 .1-2.1.7-2.7 1.4-.6.7-1.1 1.7-.9 2.7 1 .1 2-.5 2.7-1.2z" />
    </svg>
  );
}

export function AuthField({
  label,
  type = 'text',
  value,
  onChange,
  onBlur,
  placeholder,
  autoComplete,
  error,
  rightSlot,
  disabled,
  icon: Icon,
}) {
  return (
    <div>
      {label ? (
        <label className="block text-[13px] font-semibold text-zinc-300 mb-2">{label}</label>
      ) : null}
      <div
        className={`flex items-center h-12 rounded-xl border px-3.5 transition-colors ${
          error
            ? 'border-red-500/50 bg-red-500/[0.04]'
            : 'border-white/[0.1] bg-white/[0.03] focus-within:border-[#0ea4ab]/50'
        }`}
      >
        {Icon ? <Icon size={16} className="text-zinc-500 mr-2.5 shrink-0" /> : null}
        <input
          type={type}
          value={value}
          onChange={onChange}
          onBlur={onBlur}
          placeholder={placeholder}
          autoComplete={autoComplete}
          disabled={disabled}
          aria-invalid={Boolean(error)}
          className="flex-1 min-w-0 bg-transparent text-[15px] text-white outline-none placeholder:text-zinc-500 disabled:opacity-60"
        />
        {rightSlot}
      </div>
      {error ? (
        <p className="text-xs text-red-400 mt-1.5 font-medium" role="alert">{error}</p>
      ) : null}
    </div>
  );
}

export function AuthPrimaryButton({ children, loading, disabled, type = 'submit' }) {
  return (
    <button
      type={type}
      disabled={disabled || loading}
      className="w-full h-12 rounded-xl bg-logo-gradient text-[#050a1a] text-[15px] font-bold
        flex items-center justify-center
        hover:brightness-110 active:scale-[0.99] transition-all disabled:opacity-50
        shadow-[0_12px_36px_rgba(197,227,91,0.18)]"
    >
      {loading ? (
        <span className="inline-block w-5 h-5 border-2 border-[#050a1a] border-t-transparent rounded-full animate-spin" />
      ) : (
        children
      )}
    </button>
  );
}

export function AuthComplianceNote({ children }) {
  return (
    <p className="text-[11px] leading-relaxed text-zinc-500 text-center mt-6">
      {children}
    </p>
  );
}

export function AuthAppDownload() {
  return (
    <div className="mt-8 pt-6 border-t border-white/[0.06]">
      <p className="text-[12px] font-semibold text-zinc-400 mb-3 text-center">Download App</p>
      <div className="flex items-center justify-center gap-3">
        <a
          href={TOKEN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-white/[0.1] bg-white/[0.03] text-[12px] font-semibold text-zinc-300 hover:border-[#0ea4ab]/40 hover:text-white transition-colors"
        >
          App Store
        </a>
        <a
          href={TOKEN_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 h-10 px-3.5 rounded-lg border border-white/[0.1] bg-white/[0.03] text-[12px] font-semibold text-zinc-300 hover:border-[#0ea4ab]/40 hover:text-white transition-colors"
        >
          Google Play
        </a>
      </div>
    </div>
  );
}

export function AuthPromoPanel({ title, subtitle, items = [] }) {
  return (
    <aside className="ibo-auth-promo hidden lg:flex flex-col justify-center px-10 xl:px-14 py-12 relative overflow-hidden border-l border-white/[0.06]"
      style={{ background: 'linear-gradient(165deg, rgba(14,164,171,0.12) 0%, rgba(8,9,12,0.98) 45%, #08090c 100%)' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute -right-20 -bottom-24 h-72 w-72 rounded-full opacity-40"
        style={{
          background:
            'repeating-radial-gradient(circle at center, transparent 0, transparent 16px, rgba(197,227,91,0.1) 16px, rgba(197,227,91,0.1) 17px)',
        }}
      />
      <div className="relative max-w-md">
        <p className="ibo-eyebrow mb-3">Made for traders</p>
        <h2 className="font-display text-[2rem] xl:text-[2.35rem] font-bold text-white tracking-tight leading-[1.15] mb-3">
          {title}
        </h2>
        <p className="text-[15px] text-zinc-400 leading-relaxed mb-8">{subtitle}</p>
        <ul className="space-y-5">
          {items.map((item) => (
            <li key={item.title} className="flex gap-3">
              <span className="mt-1 h-2 w-2 rounded-full bg-[#C5E35B] shrink-0 shadow-[0_0_12px_rgba(197,227,91,0.5)]" />
              <div>
                <p className="text-[15px] font-semibold text-white">{item.title}</p>
                <p className="text-[13px] text-zinc-400 mt-0.5 leading-relaxed">{item.desc}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-10 text-[12px] text-zinc-500">
          Support:{' '}
          <a href={`mailto:${SITE_CONFIG.supportEmail}`} className="text-[#C5E35B] hover:underline">
            {SITE_CONFIG.supportEmail}
          </a>
        </p>
      </div>
    </aside>
  );
}

export default function AuthShell({
  children,
  side = null,
  maxWidthClass = 'max-w-[420px]',
}) {
  return (
    <div className="ibo-page min-h-[100dvh] flex flex-col">
      <header className="relative z-10 flex items-center justify-between px-5 sm:px-8 lg:px-10 py-5 border-b border-white/[0.06]">
        <AuthBrandMark />
        <Link
          to="/"
          className="text-[13px] font-medium text-zinc-400 hover:text-white transition-colors"
        >
          â†� Back to home
        </Link>
      </header>

      <div className={`relative flex-1 grid ${side ? 'lg:grid-cols-[minmax(0,1fr)_minmax(0,0.95fr)]' : ''}`}>
        <div className="flex flex-col justify-center px-5 sm:px-8 py-10 sm:py-14">
          <div className={`w-full ${maxWidthClass} mx-auto`}>{children}</div>
        </div>
        {side}
      </div>
    </div>
  );
}
