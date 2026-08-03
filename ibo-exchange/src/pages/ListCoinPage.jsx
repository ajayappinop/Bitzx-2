import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Coins, Upload, CheckCircle, AlertCircle,
  Globe, Send, Shield,
} from 'lucide-react';
import { fetchListingNetworkOptions, submitListingRequest } from '@/services/listingsApi';
import { validateListingForm } from '@/lib/listingValidation';

const INITIAL = {
  project_name: '',
  token_name: '',
  token_symbol: '',
  blockchain_network: 'BEP-20 (BNB Chain)',
  contract_address: '',
  dex_swap_link: '',
  official_website: '',
  twitter_link: '',
  telegram_link: '',
  contact_email: '',
  description: '',
};

const REQUIREMENTS = [
  { icon: Shield, title: 'Smart contract live', sub: 'Verified on-chain deployment' },
  { icon: Coins, title: 'DEX trading active', sub: 'Swap link required' },
  { icon: CheckCircle, title: 'Admin approval', sub: 'Secure listing workflow' },
];

const inputCls =
  'w-full rounded-lg bg-transparent border border-[color:var(--ibo-border-solid)] ' +
  'px-3.5 py-2.5 text-sm text-[color:var(--ibo-ink)] placeholder:text-[color:var(--ibo-muted)] ' +
  'focus:outline-none focus:border-[rgba(254, 108, 2,0.55)] focus:ring-2 focus:ring-[rgba(254, 108, 2,0.12)] ' +
  'transition-colors';

const labelCls =
  'block text-xs text-[color:var(--ibo-muted)] uppercase tracking-wider mb-2 font-semibold font-ui';

export default function ListCoinPage() {
  const [form, setForm] = useState(INITIAL);
  const [networks, setNetworks] = useState([]);
  const [logoFile, setLogoFile] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(null);
  const fileRef = useRef(null);

  useEffect(() => {
    fetchListingNetworkOptions()
      .then(setNetworks)
      .catch(() => setNetworks([
        'ERC-20 (Ethereum)',
        'BEP-20 (BNB Chain)',
        'TRC-20 (Tron)',
        'Bitcoin Network',
        'Solana',
      ]));
  }, []);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onLogo = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setError('Logo must be under 2 MB');
      return;
    }
    setLogoFile(f);
    setLogoPreview(URL.createObjectURL(f));
    setError('');
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSuccess(null);
    if (!logoFile) {
      setError('Please upload a project logo');
      return;
    }
    const validationErr = validateListingForm(form);
    if (validationErr) {
      setError(validationErr);
      return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      const payload = {
        ...form,
        token_symbol: form.token_symbol.trim().toUpperCase(),
        project_name: form.project_name.trim(),
        token_name: form.token_name.trim(),
        contact_email: form.contact_email.trim().toLowerCase(),
        description: form.description.trim(),
      };
      Object.entries(payload).forEach(([k, v]) => fd.append(k, v ?? ''));
      fd.append('logo', logoFile);
      const res = await submitListingRequest(fd);
      setSuccess(res);
      setForm(INITIAL);
      setLogoFile(null);
      setLogoPreview(null);
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setError(err.message || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="ibo-page font-ui w-full min-w-0 text-[color:var(--ibo-ink)] pb-16 md:pb-24 relative">
      <div
        className="pointer-events-none absolute inset-0"
        aria-hidden
        style={{
          background:
            'radial-gradient(ellipse 70% 40% at 8% 0%, rgba(254, 108, 2,0.1), transparent 55%), ' +
            'radial-gradient(ellipse 55% 35% at 92% 8%, rgba(254, 157, 85,0.08), transparent 50%)',
        }}
      />

      <div className="ibo-landing-container relative z-10 py-8 md:py-12 lg:py-14">
        <div className="grid w-full min-w-0 gap-8 lg:gap-10 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] xl:items-start">
          <aside className="min-w-0 xl:sticky xl:top-24">
            <p className="ibo-eyebrow mb-3 text-[#B44D01]">Token listing</p>
            <h1 className="ibo-title-lg mb-4 text-[color:var(--ibo-ink)]">List your coin on Delta</h1>
            <p className="ibo-lead-wide text-[color:var(--ibo-muted)] mb-8">
              Apply to list your token on Delta Exchange. Projects need a deployed smart contract,
              live on-chain supply, and active DEX liquidity. Our team reviews every application before
              enabling deposits, withdrawals, and spot trading.
            </p>

            <div className="grid sm:grid-cols-3 xl:grid-cols-1 gap-3 mb-8">
              {REQUIREMENTS.map(({ icon: Icon, title, sub }) => (
                <div
                  key={title}
                  className="rounded-lg border border-[color:var(--ibo-border-solid)] bg-transparent p-4
                    hover:border-[rgba(254, 108, 2,0.4)] transition-colors"
                >
                  <div
                    className="mb-2.5 inline-flex h-9 w-9 items-center justify-center rounded-lg"
                    style={{ background: 'rgba(254, 157, 85,0.12)', border: '1px solid rgba(254, 157, 85,0.25)' }}
                  >
                    <Icon size={18} className="text-[#FE9D55]" />
                  </div>
                  <p className="font-bold text-sm text-[color:var(--ibo-ink)]">{title}</p>
                  <p className="text-xs text-[color:var(--ibo-muted)] mt-1">{sub}</p>
                </div>
              ))}
            </div>

            <div
              className="rounded-lg border border-[color:var(--ibo-border-solid)] bg-transparent p-4
                text-sm text-[color:var(--ibo-muted)] leading-relaxed"
            >
              <p className="font-semibold text-[color:var(--ibo-ink)] mb-2 flex items-center gap-2">
                <Globe size={16} className="text-[#FE9D55]" />
                Supported networks
              </p>
              <p>
                ERC-20, BEP-20, and TRC-20 are enabled when RPC and contract keys are configured on the server.
                Other networks may be added after review.
              </p>
              <Link
                to="/markets"
                className="inline-block mt-3 text-[#FE9D55] text-sm font-semibold hover:underline"
              >
                View live markets →
              </Link>
            </div>
          </aside>

          <div className="min-w-0 w-full">
            {success && (
              <motion.div
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                className="mb-6 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-4 flex gap-3"
              >
                <CheckCircle className="text-emerald-500 flex-shrink-0" size={22} />
                <div>
                  <p className="font-bold text-emerald-600">Application received</p>
                  <p className="text-sm text-[color:var(--ibo-ink-secondary)] mt-1">{success.message}</p>
                  <p className="text-xs text-[color:var(--ibo-muted)] mt-2 font-mono">Ref: {success.request_id}</p>
                </div>
              </motion.div>
            )}

            {error && (
              <div className="mb-6 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-600 flex gap-2">
                <AlertCircle size={18} className="flex-shrink-0" />
                {error}
              </div>
            )}

            <form
              onSubmit={onSubmit}
              className="w-full space-y-5 rounded-xl border border-[color:var(--ibo-border-solid)]
                bg-transparent p-5 sm:p-6 md:p-8"
            >
              <h2 className="text-lg font-bold border-b border-[color:var(--ibo-border-solid)] pb-3 text-[color:var(--ibo-ink)]">
                Project details
              </h2>

              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Project name *" value={form.project_name} onChange={(v) => set('project_name', v)} required minLength={2} maxLength={120} />
                <Field label="Token name *" value={form.token_name} onChange={(v) => set('token_name', v)} required minLength={2} maxLength={80} />
                <Field label="Token symbol *" value={form.token_symbol} onChange={(v) => set('token_symbol', v.toUpperCase())} placeholder="e.g. Delta" required minLength={2} maxLength={12} />
                <div>
                  <label className={labelCls}>Blockchain network *</label>
                  <select
                    value={form.blockchain_network}
                    onChange={(e) => set('blockchain_network', e.target.value)}
                    className={inputCls}
                  >
                    {networks.map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              </div>

              <Field label="Contract address *" value={form.contract_address} onChange={(v) => set('contract_address', v)} placeholder="0x…" mono required />
              <Field label="DEX swap link *" value={form.dex_swap_link} onChange={(v) => set('dex_swap_link', v)} placeholder="https://pancakeswap.finance/…" required />

              <h2 className="text-lg font-bold border-b border-[color:var(--ibo-border-solid)] pb-3 pt-2 text-[color:var(--ibo-ink)]">
                Links & contact
              </h2>
              <div className="grid sm:grid-cols-2 gap-4">
                <Field label="Official website *" value={form.official_website} onChange={(v) => set('official_website', v)} required />
                <Field label="Contact email *" value={form.contact_email} onChange={(v) => set('contact_email', v)} type="email" required />
                <Field label="Twitter / X" value={form.twitter_link} onChange={(v) => set('twitter_link', v)} />
                <Field label="Telegram" value={form.telegram_link} onChange={(v) => set('telegram_link', v)} />
              </div>

              <div>
                <label className={labelCls}>Short project description *</label>
                <textarea
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  rows={4}
                  className={`${inputCls} resize-y`}
                  placeholder="Tell us about your project, utility, and community (min. 20 characters)."
                  required
                  minLength={20}
                  maxLength={2000}
                />
              </div>

              <div>
                <label className={labelCls}>Logo upload *</label>
                <div className="flex flex-wrap items-center gap-4">
                  {logoPreview && (
                    <img
                      src={logoPreview}
                      alt=""
                      className="w-16 h-16 rounded-full object-cover ring-2 ring-[rgba(254, 157, 85,0.45)]"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg border border-dashed
                      border-[color:var(--ibo-border-solid)] text-sm text-[color:var(--ibo-ink)]
                      bg-transparent hover:border-[rgba(254, 108, 2,0.5)]
                      hover:text-[#FE9D55] transition-colors"
                  >
                    <Upload size={16} />
                    {logoFile ? logoFile.name : 'Choose PNG, JPG, or WebP (max 2 MB)'}
                  </button>
                  <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onLogo} />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-3.5 rounded-xl font-extrabold text-sm
                  disabled:opacity-50 transition-opacity"
                style={{
                  background: 'linear-gradient(135deg, #FE6C02, #FE9D55)',
                  color: '#101013',
                  boxShadow: '0 10px 28px rgba(254, 108, 2,0.22)',
                }}
              >
                {loading ? 'Submitting…' : (
                  <>
                    <Send size={16} />
                    Submit listing application
                  </>
                )}
              </button>

              <p className="text-xs text-[color:var(--ibo-muted)] text-center">
                By submitting you confirm the token is live on-chain with DEX liquidity.
              </p>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, placeholder, type = 'text', mono, required, minLength, maxLength }) {
  return (
    <div>
      <label className={labelCls}>{label}</label>
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        className={`${inputCls}${mono ? ' font-mono' : ''}`}
      />
    </div>
  );
}
