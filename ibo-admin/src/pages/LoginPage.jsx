import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { useTheme } from '@/context/ThemeContext';
import { Moon, Shield, Sun } from 'lucide-react';

export default function LoginPage() {
  const { admin, login, loading } = useAdminAuth();
  const { isLight, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (!loading && admin) return <Navigate to="/" replace />;

  const submit = async e => {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (ex) {
      setErr(ex.message || 'Login failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-[100dvh] min-h-screen bg-surface-dark flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))] relative overflow-hidden">
      <div className="admin-bg-blob one" aria-hidden />
      <div className="admin-bg-blob two" aria-hidden />
      <button
        type="button"
        onClick={toggleTheme}
        className="absolute top-4 right-4 z-20 p-2.5 rounded-xl border border-surface-border bg-surface-card text-[color:var(--ibo-ink-secondary)] hover:text-[color:var(--ibo-ink)] hover:border-[#FE6C02]/40 transition-colors"
        aria-label={isLight ? 'Switch to dark theme' : 'Switch to light theme'}
        title={isLight ? 'Dark mode' : 'Light mode'}
      >
        {isLight ? <Moon size={18} /> : <Sun size={18} />}
      </button>
      <div className="relative w-full max-w-md rounded-2xl border border-surface-border bg-surface-card p-6 sm:p-8 shadow-sm">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-[#FE6C02]/15 flex items-center justify-center border border-[#FE6C02]/30">
            <Shield className="text-[#FE6C02]" size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold tracking-tight" style={{ color: 'var(--ibo-ink)' }}>Delta Admin</h1>
            <p className="text-sm mt-1" style={{ color: 'var(--ibo-ink-secondary)' }}>Sign in to manage users, funds, and platform settings.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ibo-muted)' }}>Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="username"
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-4 py-3 outline-none focus:border-[#FE6C02]/50"
              style={{ color: 'var(--ibo-ink)' }}
              placeholder="admin@company.com"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider mb-1.5" style={{ color: 'var(--ibo-muted)' }}>Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-4 py-3 outline-none focus:border-[#FE6C02]/50"
              style={{ color: 'var(--ibo-ink)' }}
            />
          </div>
          {err && (
            <p className="text-sm text-[#EB5454] font-semibold bg-[#EB5454]/10 border border-[#EB5454]/25 rounded-lg px-3 py-2">{err}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="adm-btn-primary w-full py-3.5 text-sm"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
