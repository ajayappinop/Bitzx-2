import { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { SITE_CONFIG, hasExternalLink } from '@/config/site';

/**
 * Token marketing site has no reset form — forward to the exchange app.
 * Covers reset emails that still use FRONTEND_PUBLIC_URL (ibo.io).
 */
export default function ResetPasswordRedirect() {
  const [searchParams] = useSearchParams();
  const token = (searchParams.get('token') || '').trim();

  useEffect(() => {
    const exchangeBase = (
      hasExternalLink(SITE_CONFIG.officialExchangeUrl)
        ? SITE_CONFIG.officialExchangeUrl.replace(/\/+$/, '')
        : 'https://exchange.ibo.io'
    );
    const dest = token
      ? `${exchangeBase}/reset-password?token=${encodeURIComponent(token)}`
      : `${exchangeBase}/forgot-password`;
    window.location.replace(dest);
  }, [token]);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-6">
      <p className="text-ink-accent text-sm font-medium">Redirecting to password reset…</p>
    </div>
  );
}
