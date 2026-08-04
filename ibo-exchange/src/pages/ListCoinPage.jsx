import { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Coins, Upload, CheckCircle, AlertCircle,
  Globe, Send, Shield, Link2, FileText, Image as ImageIcon,
  ChevronRight, Layers,
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
  { icon: Shield, title: 'Smart contract live', sub: 'Verified on-chain deployment', tone: 'orange' },
  { icon: Coins, title: 'DEX trading active', sub: 'Swap link required', tone: 'teal' },
  { icon: CheckCircle, title: 'Admin approval', sub: 'Secure listing workflow', tone: 'blue' },
];

const STEPS = [
  { n: '01', title: 'Apply', body: 'Submit token details & logo' },
  { n: '02', title: 'Review', body: 'Our team verifies the project' },
  { n: '03', title: 'List', body: 'Trade enabled after approval' },
];

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

  useEffect(() => () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
  }, [logoPreview]);

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));

  const onLogo = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 2 * 1024 * 1024) {
      setError('Logo must be under 2 MB');
      return;
    }
    if (logoPreview) URL.revokeObjectURL(logoPreview);
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
      if (logoPreview) URL.revokeObjectURL(logoPreview);
      setLogoPreview(null);
      if (fileRef.current) fileRef.current.value = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message || 'Submission failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="list-hub font-ui ibo-page">
      <div className="list-hub__inner">
        {/* Toolbar */}
        <div className="delta-account-toolbar !mb-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="list-hub__mark">
              <Coins size={16} />
            </span>
            <div className="min-w-0">
              <h1 className="text-[15px] font-semibold text-[color:var(--ibo-ink)] m-0 leading-tight truncate">
                List your coin
              </h1>
              <p className="text-[11px] text-[color:var(--ibo-muted)] mt-0.5 m-0 truncate">
                Apply for deposits, withdrawals, and spot trading
              </p>
            </div>
          </div>
          <Link to="/markets" className="wallet-action-ghost text-xs !px-2.5 !py-1.5 shrink-0">
            Markets <ChevronRight size={13} />
          </Link>
        </div>

        {/* Intro strip */}
        <section className="list-intro" aria-label="Listing overview">
          <div className="list-intro__copy min-w-0">
            <p className="list-intro__kicker">Token listing</p>
            <h2 className="list-intro__title">Get listed on Delta</h2>
            <p className="list-intro__lead">
              Deployed contracts with live DEX liquidity can apply. Every application is reviewed
              before trading is enabled.
            </p>
          </div>
          <div className="list-intro__steps" aria-label="Listing process">
            {STEPS.map((s) => (
              <div key={s.n} className="list-step">
                <span className="list-step__n">{s.n}</span>
                <div className="min-w-0">
                  <p className="list-step__title">{s.title}</p>
                  <p className="list-step__body">{s.body}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Requirements */}
        <div className="list-req-row">
          {REQUIREMENTS.map(({ icon: Icon, title, sub, tone }) => (
            <div key={title} className={`list-req list-req--${tone}`}>
              <span className="list-req__icon">
                <Icon size={15} />
              </span>
              <div className="min-w-0">
                <p className="list-req__title">{title}</p>
                <p className="list-req__sub">{sub}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Network note */}
        <div className="list-net">
          <Globe size={15} className="list-net__icon shrink-0" />
          <p className="list-net__text">
            <strong>Networks:</strong> ERC-20, BEP-20, and TRC-20 when RPC and keys are configured.
            Other chains may open after review.
          </p>
        </div>

        {success ? (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="list-alert list-alert--ok"
            role="status"
          >
            <CheckCircle size={20} className="shrink-0" />
            <div className="min-w-0">
              <p className="list-alert__title">Application received</p>
              <p className="list-alert__body">{success.message}</p>
              <p className="list-alert__ref">Ref: {success.request_id}</p>
            </div>
          </motion.div>
        ) : null}

        {error ? (
          <div className="list-alert list-alert--err" role="alert">
            <AlertCircle size={18} className="shrink-0" />
            <p className="list-alert__body m-0">{error}</p>
          </div>
        ) : null}

        {/* Application form */}
        <form onSubmit={onSubmit} className="list-form space-y-5">
          <section className="list-section" aria-labelledby="list-token-heading">
            <header className="list-section__head">
              <span className="list-section__icon list-section__icon--orange">
                <Coins size={15} />
              </span>
              <div className="min-w-0">
                <h2 id="list-token-heading" className="list-section__title">Token identity</h2>
                <p className="list-section__sub">Project and token display details</p>
              </div>
            </header>
            <div className="list-grid">
              <Field
                label="Project name"
                required
                value={form.project_name}
                onChange={(v) => set('project_name', v)}
                minLength={2}
                maxLength={120}
              />
              <Field
                label="Token name"
                required
                value={form.token_name}
                onChange={(v) => set('token_name', v)}
                minLength={2}
                maxLength={80}
              />
              <Field
                label="Token symbol"
                required
                value={form.token_symbol}
                onChange={(v) => set('token_symbol', v.toUpperCase())}
                placeholder="e.g. IBO"
                minLength={2}
                maxLength={12}
              />
              <div className="min-w-0">
                <label className="ibo-field-label !mb-1.5" htmlFor="list-network">
                  Blockchain network <span className="text-[#F6465D]">*</span>
                </label>
                <div className="list-select-wrap">
                  <select
                    id="list-network"
                    value={form.blockchain_network}
                    onChange={(e) => set('blockchain_network', e.target.value)}
                    className="list-select"
                    required
                  >
                    {(networks.length ? networks : [form.blockchain_network]).map((n) => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                  <Layers size={14} className="list-select__ico" aria-hidden />
                </div>
              </div>
            </div>
          </section>

          <section className="list-section" aria-labelledby="list-chain-heading">
            <header className="list-section__head">
              <span className="list-section__icon list-section__icon--teal">
                <Link2 size={15} />
              </span>
              <div className="min-w-0">
                <h2 id="list-chain-heading" className="list-section__title">On-chain &amp; DEX</h2>
                <p className="list-section__sub">Contract and proven liquidity</p>
              </div>
            </header>
            <div className="list-stack">
              <Field
                label="Contract address"
                required
                value={form.contract_address}
                onChange={(v) => set('contract_address', v)}
                placeholder="0x…"
                mono
              />
              <Field
                label="DEX swap link"
                required
                value={form.dex_swap_link}
                onChange={(v) => set('dex_swap_link', v)}
                placeholder="https://pancakeswap.finance/…"
              />
            </div>
          </section>

          <section className="list-section" aria-labelledby="list-links-heading">
            <header className="list-section__head">
              <span className="list-section__icon list-section__icon--blue">
                <Globe size={15} />
              </span>
              <div className="min-w-0">
                <h2 id="list-links-heading" className="list-section__title">Links &amp; contact</h2>
                <p className="list-section__sub">Where reviewers can reach your team</p>
              </div>
            </header>
            <div className="list-grid">
              <Field
                label="Official website"
                required
                value={form.official_website}
                onChange={(v) => set('official_website', v)}
                placeholder="https://"
              />
              <Field
                label="Contact email"
                required
                type="email"
                value={form.contact_email}
                onChange={(v) => set('contact_email', v)}
                placeholder="team@project.com"
              />
              <Field
                label="Twitter / X"
                value={form.twitter_link}
                onChange={(v) => set('twitter_link', v)}
                placeholder="https://x.com/…"
              />
              <Field
                label="Telegram"
                value={form.telegram_link}
                onChange={(v) => set('telegram_link', v)}
                placeholder="https://t.me/…"
              />
            </div>
          </section>

          <section className="list-section" aria-labelledby="list-pitch-heading">
            <header className="list-section__head">
              <span className="list-section__icon list-section__icon--amber">
                <FileText size={15} />
              </span>
              <div className="min-w-0">
                <h2 id="list-pitch-heading" className="list-section__title">Pitch &amp; branding</h2>
                <p className="list-section__sub">Description and project logo</p>
              </div>
            </header>

            <div className="list-stack">
              <div className="min-w-0">
                <div className="flex items-end justify-between gap-2 mb-1.5">
                  <label className="ibo-field-label !mb-0" htmlFor="list-desc">
                    Short project description <span className="text-[#F6465D]">*</span>
                  </label>
                  <span className="text-[11px] font-semibold tabular-nums text-[color:var(--ibo-muted)]">
                    {form.description.length}/2000
                  </span>
                </div>
                <textarea
                  id="list-desc"
                  value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  rows={4}
                  className="wallet-field resize-y min-h-[7rem]"
                  placeholder="Tell us about your project, utility, and community (min. 20 characters)."
                  required
                  minLength={20}
                  maxLength={2000}
                />
              </div>

              <div className="min-w-0">
                <label className="ibo-field-label !mb-1.5">
                  Logo upload <span className="text-[#F6465D]">*</span>
                </label>
                <div className={`list-logo${logoFile ? ' is-ready' : ''}`}>
                  <div className="list-logo__preview" aria-hidden>
                    {logoPreview ? (
                      <img src={logoPreview} alt="" />
                    ) : (
                      <ImageIcon size={22} />
                    )}
                  </div>
                  <div className="list-logo__meta min-w-0">
                    <p className="list-logo__name truncate">
                      {logoFile ? logoFile.name : 'PNG, JPG, or WebP · max 2 MB'}
                    </p>
                    <p className="list-logo__hint">
                      Square logo works best on markets and trade views
                    </p>
                    <button
                      type="button"
                      onClick={() => fileRef.current?.click()}
                      className="wallet-action-ghost text-xs !px-2.5 !py-1.5 mt-2"
                    >
                      <Upload size={13} />
                      {logoFile ? 'Change logo' : 'Choose file'}
                    </button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={onLogo}
                    />
                  </div>
                </div>
              </div>
            </div>
          </section>

          <div className="list-submit">
            <div className="min-w-0">
              <p className="list-submit__title">Ready to apply?</p>
              <p className="list-submit__sub">
                Confirm the token is live on-chain with DEX liquidity.
              </p>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="wallet-action-primary list-submit__btn disabled:opacity-45"
            >
              {loading ? (
                <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <>
                  <Send size={15} />
                  Submit application
                </>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  mono,
  required,
  minLength,
  maxLength,
}) {
  const id = `list-${label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
  return (
    <div className="min-w-0">
      <label className="ibo-field-label !mb-1.5" htmlFor={id}>
        {label}
        {required ? <span className="text-[#F6465D] ml-0.5">*</span> : null}
      </label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        required={required}
        minLength={minLength}
        maxLength={maxLength}
        className={`wallet-field${mono ? ' font-mono text-[13px]' : ''}`}
      />
    </div>
  );
}
