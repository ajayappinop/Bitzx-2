import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { Shield } from 'lucide-react';

export default function LoginPage() {
  const { admin, login, loading } = useAdminAuth();
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
    <div className="min-h-[100dvh] min-h-screen bg-surface-dark flex items-center justify-center p-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="w-full max-w-md rounded-2xl border border-surface-border bg-surface-card p-6 sm:p-8 shadow-2xl">
        <div className="flex items-center gap-3 mb-8">
          <div className="w-12 h-12 rounded-xl bg-gold/15 flex items-center justify-center border border-gold/25">
            <Shield className="text-gold-light" size={26} />
          </div>
          <div>
            <h1 className="text-2xl font-extrabold text-white">IBO Admin</h1>
            <p className="text-white/70 text-base mt-1">Sign in to manage users, money, and platform settings.</p>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-1.5">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              required
              autoComplete="username"
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-4 py-3 text-white placeholder:text-white/30 focus:border-gold/50 outline-none"
              placeholder="admin@company.com"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-white/60 uppercase tracking-wider mb-1.5">Password</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              required
              autoComplete="current-password"
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-4 py-3 text-white placeholder:text-white/30 focus:border-gold/50 outline-none"
            />
          </div>
          {err && (
            <p className="text-sm text-red-400 font-semibold bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{err}</p>
          )}
          <button
            type="submit"
            disabled={busy}
            className="w-full py-3.5 rounded-xl font-extrabold bg-logo-gradient text-surface-dark disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  );
}
