import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Shield, RefreshCw, Plus, Trash2, Bell, Activity, Smartphone, Sparkles, Gift, MessageSquare } from 'lucide-react';
import { api } from '@/lib/api';
import ConfirmModal from '@/components/ConfirmModal';
import { AdminPageHeader, AdminPanel } from '@/components/AdminPrimitives';
import RpcUsagePanel from '@/components/RpcUsagePanel';

// Phase 8 — per-symbol spread / inventory-limit overrides are stored as
// dicts on platform_controls. The dynamic editor below normalises rows into
// the dict shape on save and back into rows on load.
function dictToRows(dict) {
  if (!dict || typeof dict !== 'object') return [];
  return Object.entries(dict).map(([symbol, value]) => ({
    symbol: String(symbol || '').toUpperCase(),
    value: String(value ?? ''),
  }));
}

function rowsToDict(rows) {
  const out = {};
  for (const r of rows || []) {
    const sym = String(r?.symbol || '').toUpperCase().trim();
    const val = Number(r?.value);
    if (!sym || !Number.isFinite(val) || val < 0) continue;
    out[sym] = val;
  }
  return out;
}

/** Feature toggles: human title, short hint, inverted = “on” is restrictive (maintenance). */
const PLATFORM_FEATURES = [
  { key: 'coming_soon_enabled', title: 'Coming Soon gate', description: 'When on, only the Coming Soon page is shown. All other exchange routes are blocked.', inverted: true },
  { key: 'maintenance_mode', title: 'Maintenance mode', description: 'When on, customers see maintenance and most product actions are blocked.', inverted: true },
  { key: 'signup_enabled', title: 'New registrations', description: 'Allow new accounts to be created.', inverted: false },
  { key: 'login_enabled', title: 'User sign-in', description: 'Allow existing customers to log in.', inverted: false },
  { key: 'email_otp_service_enabled', title: 'Email OTP verification', description: 'When OFF, signup skips email OTP entirely — email is collected but not verified. Users can verify later from their profile.', inverted: false },
  { key: 'sms_otp_service_enabled', title: 'SMS OTP verification', description: 'When OFF, the phone number step is hidden during signup — no SMS is sent. Users can add and verify their mobile from their profile.', inverted: false },
  { key: 'trading_enabled', title: 'Trading', description: 'Order placement and matching.', inverted: false },
  { key: 'system_liquidity_enabled', title: 'System treasury liquidity', description: 'Allow market-order remainder to be filled by internal SYSTEM treasury liquidity.', inverted: false },
  { key: 'kyc_enabled', title: 'KYC flow', description: 'Identity verification submissions and processing.', inverted: false },
  { key: 'wallet_enabled', title: 'Wallet', description: 'Deposits and withdrawals.', inverted: false },
  { key: 'profile_enabled', title: 'Profile updates', description: 'Customers can edit profile fields.', inverted: false },
  { key: 'deposit_auto_credit_enabled', title: 'Auto-credit deposits', description: 'Phase 4: after required confirmations, credit the user wallet (poller + crediter workers must be running).', inverted: false },
  { key: 'withdrawal_auto_execute_enabled', title: 'Auto-send withdrawals', description: 'Execute eligible withdrawals without manual approval.', inverted: false },
  { key: 'two_factor_enabled', title: 'Two-factor authentication', description: 'Customers may enable 2FA on their account.', inverted: false },
  { key: 'two_factor_required_for_withdrawal', title: '2FA required to withdraw', description: 'Withdrawals require a verified second factor.', inverted: false },
  { key: 'rate_limit_enabled', title: 'Rate limiting', description: 'Throttle sensitive endpoints using the limits below.', inverted: false },
];

function platformFeatureMeta(key) {
  return PLATFORM_FEATURES.find((f) => f.key === key) || { key, title: key.replaceAll('_', ' '), description: '', inverted: false };
}

function platformSwitchStatus(key, enabled) {
  if (key === 'maintenance_mode') {
    return enabled ? 'On — maintenance shown to users' : 'Off — normal service';
  }
  return enabled ? 'Enabled' : 'Disabled';
}

/** QuickNode / JSON-RPC chains — toggled via platform_controls.blockchain_chain_settings */
const BLOCKCHAIN_RPC_CHAINS = [
  { id: 'btc', title: 'Bitcoin', hint: 'BTC deposits & scanning (QUICKNODE_BTC_URL)' },
  { id: 'eth', title: 'Ethereum', hint: 'ETH / ERC-20 USDT — HTTP + optional WS (QUICKNODE_ETH_URL)' },
  { id: 'bsc', title: 'BNB Smart Chain', hint: 'BNB / BEP-20 USDT (QUICKNODE_BSC_URL)' },
  { id: 'tron', title: 'Tron', hint: 'TRX / TRC-20 USDT (QUICKNODE_TRON_URL)' },
  { id: 'solana', title: 'Solana', hint: 'SOL deposits (QUICKNODE_SOLANA_URL)' },
];

function blockchainChainEnabled(settings, chainId) {
  const raw = settings?.[chainId];
  if (raw === false) return false;
  if (typeof raw === 'object' && raw != null && raw.enabled === false) return false;
  return true;
}

function normalizeBlockchainChainSettings(settings) {
  const out = {};
  for (const { id } of BLOCKCHAIN_RPC_CHAINS) {
    out[id] = blockchainChainEnabled(settings, id);
  }
  return out;
}

function BlockchainRpcSection({ controls, patchControls, busy }) {
  const settings = controls?.blockchain_chain_settings;

  async function toggleChain(chainId) {
    const merged = normalizeBlockchainChainSettings(settings);
    merged[chainId] = !merged[chainId];
    await patchControls({ blockchain_chain_settings: merged });
  }

  return (
    <AdminPanel
      title="Blockchain RPC endpoints"
      subtitle="Turn off a chain to hide it from exchange & mobile wallet UIs and stop deposit scanning. Env URLs stay in the API server .env — this only controls runtime enablement."
      className="mb-6"
    >
      {!controls ? (
        <p className="text-white/55 text-sm">Loading…</p>
      ) : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {BLOCKCHAIN_RPC_CHAINS.map(({ id, title, hint }) => {
            const enabled = blockchainChainEnabled(settings, id);
            return (
              <button
                key={id}
                type="button"
                disabled={busy}
                onClick={() => toggleChain(id)}
                className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                  enabled
                    ? 'border-emerald-500/35 bg-emerald-500/10'
                    : 'border-surface-border bg-surface-dark opacity-80'
                }`}
              >
                <p className="text-sm font-bold text-white">{title}</p>
                <p className="text-xs text-white/65 mt-1.5 leading-relaxed">{hint}</p>
                <p className={`text-xs font-semibold mt-2 ${enabled ? 'text-emerald-300' : 'text-gold-light/90'}`}>
                  {enabled ? 'Enabled — live for customers' : 'Disabled — hidden & no scanning'}
                </p>
                <p className="text-[10px] font-mono text-white/40 mt-2">{id}</p>
              </button>
            );
          })}
        </div>
      )}
      <p className="text-xs text-white/50 mt-4 leading-relaxed">
        Changes apply immediately to wallet APIs. ETH/BSC WebSocket listeners stop on their next reconnect when disabled.
        Restart the API process if a listener does not detach promptly.
      </p>
    </AdminPanel>
  );
}

const SETTINGS_TABS = [
  { id: 'general', label: 'General Controls' },
  { id: 'limits', label: 'Limits & Risk' },
  { id: 'referral', label: 'Refer & Earn' },
  { id: 'deposit_monitor', label: 'Deposit Monitor' },
  { id: 'hedging', label: 'Binance Hedger' },
  { id: 'binance_liquidity', label: 'Binance Liquidity' },
  { id: 'alerts', label: 'Alerts & Webhooks' },
];

// ── Deposit Monitor Section ───────────────────────────────────────────────────

const DEPOSIT_MONITOR_NUMERIC_FIELDS = [
  {
    key:   'deposit_monitor_session_duration_sec',
    label: 'Session duration (seconds)',
    hint:  'How long a monitoring session stays active before expiring automatically. 420 = 7 minutes (default).',
    min:   60,
    max:   1800,
    step:  30,
  },
  {
    key:   'deposit_monitor_scan_interval_sec',
    label: 'Scan interval (seconds)',
    hint:  'Minimum seconds between blockchain checks. Lower = more QuickNode credits. 30 is recommended.',
    min:   10,
    max:   300,
    step:  5,
  },
  {
    key:   'deposit_monitor_max_scans_per_session',
    label: 'Max scans per session',
    hint:  'Hard cap on RPC calls per session. Prevents runaway costs. 20 = one scan every 30 s for ~10 min of headroom.',
    min:   1,
    max:   100,
    step:  1,
  },
  {
    key:   'deposit_monitor_cooldown_sec',
    label: 'Cooldown between sessions (seconds)',
    hint:  'Required wait after a session ends before the user can start another. Prevents restart spam.',
    min:   0,
    max:   600,
    step:  10,
  },
];

function DepositMonitorSection({ controls, patchControls, busy }) {
  const [fields, setFields] = useState(null);
  const [messages, setMessages] = useState({ monitor: '', expired: '' });
  const [saving, setSaving] = useState(false);
  const [saved,  setSaved]  = useState(false);
  const [err,    setErr]    = useState(null);

  useEffect(() => {
    if (!controls) return;
    const init = {};
    for (const f of DEPOSIT_MONITOR_NUMERIC_FIELDS) {
      init[f.key] = String(controls[f.key] ?? '');
    }
    setFields(init);
    setMessages({
      monitor: controls.deposit_monitor_message ?? '',
      expired: controls.deposit_monitor_expired_message ?? '',
    });
  }, [controls]);

  async function save() {
    setSaving(true);
    setErr(null);
    try {
      const patch = {};
      for (const f of DEPOSIT_MONITOR_NUMERIC_FIELDS) {
        const v = Number(fields?.[f.key]);
        if (Number.isFinite(v) && v >= 0) patch[f.key] = v;
      }
      if (messages.monitor.trim()) patch.deposit_monitor_message = messages.monitor.trim();
      if (messages.expired.trim()) patch.deposit_monitor_expired_message = messages.expired.trim();
      await patchControls(patch);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e) {
      setErr(e?.message || 'Save failed.');
    } finally {
      setSaving(false);
    }
  }

  const enabled = !!controls?.deposit_monitor_enabled;

  return (
    <div className="space-y-6">
      {/* ── Master enable/disable ── */}
      <AdminPanel
        title="On-demand deposit monitoring"
        subtitle="When enabled, users can start a monitoring session on the Wallet → History → Deposits page. The session runs blockchain scans on-demand — only when a user is actively watching — instead of 24/7. This reduces QuickNode credit usage by ~98% vs continuous polling."
        className="mb-0"
      >
        {!controls ? (
          <p className="text-white/55 text-sm">Loading…</p>
        ) : (
          <div className="space-y-5">
            {/* Enable toggle */}
            <div className={`flex items-start gap-4 rounded-xl border px-5 py-4 ${
              enabled
                ? 'border-emerald-500/35 bg-emerald-500/10'
                : 'border-surface-border bg-surface-dark opacity-80'
            }`}>
              <div className="flex-1">
                <p className="font-bold text-white text-sm">Deposit monitoring</p>
                <p className="text-xs text-white/60 mt-1 leading-relaxed">
                  When <strong className="text-white/90">ON</strong>, users see the monitoring
                  banner on the Deposits history page and can start/stop sessions. When{' '}
                  <strong className="text-white/90">OFF</strong>, the feature is hidden and the
                  session API returns 503.
                </p>
                <p className={`text-xs font-bold mt-2 ${enabled ? 'text-emerald-300' : 'text-gold-light/90'}`}>
                  {enabled ? '✓ Monitoring available to users' : '⚠ Monitoring disabled — no sessions allowed'}
                </p>
              </div>
              <button
                type="button"
                disabled={busy}
                onClick={() => patchControls({ deposit_monitor_enabled: !enabled })}
                style={{
                  flexShrink: 0, width: 48, height: 26, position: 'relative',
                  borderRadius: 9999, border: 'none', cursor: 'pointer',
                  transition: 'background 0.2s',
                  background: enabled ? '#10b981' : 'rgba(255,255,255,0.15)', padding: 0,
                }}
                aria-checked={enabled}
                role="switch"
              >
                <span style={{
                  display: 'block', position: 'absolute', top: 3,
                  left: enabled ? 25 : 3, width: 20, height: 20,
                  borderRadius: '50%', background: '#fff',
                  boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                  transition: 'left 0.2s',
                }} />
              </button>
            </div>

            {/* Credit savings info */}
            <div className="rounded-xl border border-[#FE6C02]/20 bg-[#FE6C02]/8 px-4 py-3 text-xs text-[#FE9D55]/80 leading-relaxed">
              <p className="font-semibold text-[#FE9D55] mb-1">Estimated QuickNode savings</p>
              <p>
                Continuous poller: ~4.8 M credits/day (BSC alone at 1 block/3 s × 166 creds/block).
                On-demand at 30 s interval, 50 daily users: ~100 K credits/day — <span className="font-bold text-[#FE9D55]">~98% reduction</span>.
              </p>
            </div>
          </div>
        )}
      </AdminPanel>

      {/* ── Numeric settings ── */}
      <AdminPanel
        title="Session parameters"
        subtitle="All changes take effect immediately for new sessions. Active sessions use the config snapshot from when they were created."
        className="mb-0"
      >
        {!fields ? (
          <p className="text-white/55 text-sm">Loading…</p>
        ) : (
          <div className="space-y-4">
            <div className="grid sm:grid-cols-2 gap-4">
              {DEPOSIT_MONITOR_NUMERIC_FIELDS.map((f) => (
                <label key={f.key} className="block">
                  <span className="block text-sm font-semibold text-white mb-1">{f.label}</span>
                  <span className="block text-xs text-white/50 mb-2 leading-relaxed">{f.hint}</span>
                  <input
                    type="number"
                    step={f.step}
                    min={f.min}
                    max={f.max}
                    value={fields[f.key] ?? ''}
                    onChange={e => setFields(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white focus:border-gold/50 outline-none transition-colors"
                  />
                </label>
              ))}
            </div>

            {/* Message fields */}
            <div className="space-y-4 pt-2">
              <label className="block">
                <span className="block text-sm font-semibold text-white mb-1">
                  Active monitoring message
                </span>
                <span className="block text-xs text-white/50 mb-2">
                  Shown in the green banner while monitoring is running.
                </span>
                <input
                  type="text"
                  value={messages.monitor}
                  onChange={e => setMessages(prev => ({ ...prev, monitor: e.target.value }))}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white focus:border-gold/50 outline-none transition-colors"
                  placeholder="Monitoring active — new deposits typically appear within 1–3 minutes."
                />
              </label>
              <label className="block">
                <span className="block text-sm font-semibold text-white mb-1">
                  Expired monitoring message
                </span>
                <span className="block text-xs text-white/50 mb-2">
                  Shown in the amber banner after a session ends.
                </span>
                <input
                  type="text"
                  value={messages.expired}
                  onChange={e => setMessages(prev => ({ ...prev, expired: e.target.value }))}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white focus:border-gold/50 outline-none transition-colors"
                  placeholder="Monitoring stopped. Tap Restart to resume watching for deposits."
                />
              </label>
            </div>

            {err && <p className="text-red-400 text-sm">{err}</p>}

            <div className="flex items-center gap-3 pt-1">
              <button
                type="button"
                disabled={saving || busy}
                onClick={save}
                className="px-5 py-2 rounded-xl bg-gold/20 border border-gold/30 text-gold-light text-sm font-semibold hover:bg-gold/30 transition-colors disabled:opacity-40"
              >
                {saving ? 'Saving…' : saved ? '✓ Saved' : 'Save session parameters'}
              </button>
              {saved && <span className="text-xs text-emerald-400">Changes applied immediately.</span>}
            </div>
          </div>
        )}
      </AdminPanel>
    </div>
  );
}

// Phase 8d — Binance hedger globals. Per-symbol config (mode /
// rebalance threshold / max hedge size / cooldown) is edited inline
// on the Hedger admin page; this section only covers the four
// *global* toggles that apply to every symbol:
//
//   hedger_enabled          — master kill switch (disables the worker
//                             AND blocks manual executes)
//   hedger_dry_run          — simulate everything, never touch Binance
//   hedger_default_mode     — off / manual / auto (fallback when a
//                             symbol has no explicit mode)
//   hedger_price_sanity_bps — max allowed drift between Binance mark
//                             and our mark before a hedge is refused
//
// Kept as its own component (mirrors AlertWebhookSection) because the
// value shapes are mixed (bool, enum, number) and don't fit cleanly
// into the numeric ``limits`` object used by the fee/withdrawal form.
function HedgerGlobalsSection({ controls, patchControls, busy }) {
  const [enabled, setEnabled] = useState(false);
  const [dryRun, setDryRun]   = useState(true);
  const [mode, setMode]       = useState('off');
  const [sanityBps, setSanityBps] = useState('50');
  const [confirm, setConfirm] = useState({ open: false, kind: '' });

  useEffect(() => {
    if (!controls) return;
    setEnabled(!!controls.hedger_enabled);
    setDryRun(!!controls.hedger_dry_run);
    setMode(String(controls.hedger_default_mode || 'off'));
    setSanityBps(String(controls.hedger_price_sanity_bps ?? 50));
  }, [controls]);

  async function save() {
    const bps = Math.max(0, Number(sanityBps) || 0);
    await patchControls({
      hedger_enabled:            enabled,
      hedger_dry_run:            dryRun,
      hedger_default_mode:       mode,
      hedger_price_sanity_bps:   bps,
    });
  }

  // Quick-toggle helpers so the master switch and dry-run can be flipped
  // without having to click Save. They go through ``patchControls``
  // directly which already handles the audit note + busy state.
  async function toggleMaster() {
    const next = !enabled;
    if (!next) {
      setConfirm({ open: true, kind: 'master' });
      return;
    }
    setEnabled(next);
    await patchControls({ hedger_enabled: next });
  }

  async function toggleDryRun() {
    const next = !dryRun;
    if (!next) {
      setConfirm({ open: true, kind: 'dry_run' });
      return;
    }
    setDryRun(next);
    await patchControls({ hedger_dry_run: next });
  }

  return (
    <AdminPanel
      title="Hedging (global)"
      subtitle="Defaults for the Binance hedge worker. Per-symbol mode, thresholds, and cooldowns are managed on the Hedging screen."
    >
      <div className="flex items-start gap-3 mb-4 text-white/75 text-sm leading-relaxed">
        <Activity className="shrink-0 text-gold-light/90 mt-0.5" size={18} />
        <p>
          When the master switch is off, the worker stops and manual hedge runs are blocked. Configure per-pair behavior on the{' '}
          <Link to="/hedger" className="text-gold-light font-semibold hover:underline">Hedging</Link> page.
        </p>
      </div>

      <div className="mb-5 p-4 rounded-xl border border-gold/25 bg-gold/10 text-gold-light/90 text-sm space-y-2">
        <p className="font-bold text-gold-light">Environment dependency</p>
        <p>
          The process must also have <code className="font-mono text-xs bg-surface-dark px-1.5 py-0.5 rounded">HEDGER_WORKER_ENABLED=true</code> in{' '}
          <code className="font-mono text-xs bg-surface-dark px-1.5 py-0.5 rounded">backend/.env</code> or the worker never starts. Use the live banner on{' '}
          <Link to="/hedger" className="underline font-semibold">Hedging</Link> to confirm state.
        </p>
      </div>

      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        <button
          type="button"
          onClick={toggleMaster}
          disabled={busy}
          className={`text-left px-4 py-3 rounded-xl border transition-colors ${
            enabled
              ? 'border-green-500/35 bg-green-500/10'
              : 'border-red-500/35 bg-red-500/10'
          }`}
        >
          <p className="text-sm font-bold text-white">Master switch</p>
          <p className="text-xs text-white/70 mt-1">hedger_enabled</p>
          <p className="text-sm mt-2 text-white/85">
            {enabled ? 'Worker runs on schedule; hedging can proceed per symbol rules.' : 'Worker idle; manual hedge actions rejected.'}
          </p>
        </button>
        <button
          type="button"
          onClick={toggleDryRun}
          disabled={busy}
          className={`text-left px-4 py-3 rounded-xl border transition-colors ${
            dryRun
              ? 'border-sky-500/35 bg-sky-500/10'
              : 'border-gold/35 bg-gold/10'
          }`}
        >
          <p className="text-sm font-bold text-white">Dry run</p>
          <p className="text-xs text-white/70 mt-1">hedger_dry_run</p>
          <p className="text-sm mt-2 text-white/85">
            {dryRun ? 'Simulates only; no orders sent to Binance.' : 'Live mode: successful runs place real Binance orders.'}
          </p>
        </button>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-sm font-semibold text-white mb-1">Default hedge mode</span>
          <span className="block text-xs text-white/55 mb-2 font-mono">hedger_default_mode</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value)}
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="off">Off — ignore unless overridden per symbol</option>
            <option value="manual">Manual — suggestions only; you execute</option>
            <option value="auto">Automatic — worker executes per policy</option>
          </select>
          <p className="text-xs text-white/50 mt-2">
            Used for symbols without their own mode on the Hedging page.
          </p>
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-white mb-1">Mark price tolerance (basis points)</span>
          <span className="block text-xs text-white/55 mb-2 font-mono">hedger_price_sanity_bps</span>
          <input
            type="number"
            step="1"
            min="0"
            max="10000"
            value={sanityBps}
            onChange={(e) => setSanityBps(e.target.value)}
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          />
          <p className="text-xs text-white/50 mt-2">
            Refuse a hedge when Binance mark and internal mark differ by more than this (50 bps = 0.5%).
          </p>
        </label>
      </div>

      <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 pt-4 border-t border-surface-border/70">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-40 shrink-0"
        >
          Save mode and tolerance
        </button>
        <p className="text-xs text-white/55">
          Master switch and dry run apply immediately when toggled. Default mode and tolerance apply when you save here.
        </p>
      </div>
      <ConfirmModal
        open={confirm.open}
        title={confirm.kind === 'master' ? 'Disable hedging master switch' : 'Disable dry run'}
        message={confirm.kind === 'master'
          ? 'The background worker stops evaluating symbols immediately and manual executions are rejected.'
          : 'The next successful AUTO/MANUAL execution places a real Binance order (testnet or mainnet based on BINANCE_TESTNET).'}
        confirmText={confirm.kind === 'master' ? 'Disable master' : 'Disable dry-run'}
        danger
        onClose={() => setConfirm({ open: false, kind: '' })}
        onConfirm={async () => {
          if (confirm.kind === 'master') {
            setEnabled(false);
            await patchControls({ hedger_enabled: false });
          } else {
            setDryRun(false);
            await patchControls({ hedger_dry_run: false });
          }
          setConfirm({ open: false, kind: '' });
        }}
      />
    </AdminPanel>
  );
}

// Phase 9c — Alert webhook + min-severity editor. Lives in its own
// component so its local string/enum state doesn't have to shoehorn
// into the numeric ``limits`` object used by the fee/withdrawal form.
// ── Refer & Earn Section ──────────────────────────────────────────────────

function ReferralSection({ controls, patchControls, busy }) {
  const [enabled, setEnabled] = useState(false);
  const [levelRows, setLevelRows] = useState([{ level: '1', amount_ibo: '0' }]);
  const [flatEnabled, setFlatEnabled] = useState(false);
  const [flatFromLevel, setFlatFromLevel] = useState('');
  const [flatAmountIbo, setFlatAmountIbo] = useState('0');
  const [levelErr, setLevelErr] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [playstoreUrl, setPlaystoreUrl] = useState('');

  useEffect(() => {
    if (!controls) return;
    setEnabled(Boolean(controls.referral_enabled));
    const rows = Array.isArray(controls.referral_levels) ? controls.referral_levels : [];
    setLevelRows(
      rows.length
        ? rows.map((r) => ({ level: String(r.level ?? ''), amount_ibo: String(r.amount_ibo ?? '0') }))
        : [{ level: '1', amount_ibo: '0' }],
    );
    const flatFrom = Number(controls.referral_flat_from_level || 0);
    setFlatEnabled(flatFrom > 0);
    setFlatFromLevel(flatFrom > 0 ? String(flatFrom) : '');
    setFlatAmountIbo(String(controls.referral_flat_amount_ibo ?? '0'));
    setWebsiteUrl(String(controls.referral_share_website_url || ''));
    setPlaystoreUrl(String(controls.referral_share_playstore_url || ''));
    setLevelErr('');
  }, [controls]);

  function validateLevelConfig(rows, flatOn, flatFromRaw, flatAmtRaw) {
    const parsed = rows
      .map((r) => ({ level: Number(r.level), amount_ibo: Number(r.amount_ibo) }))
      .filter((r) => Number.isFinite(r.level) && r.level >= 1 && Number.isFinite(r.amount_ibo) && r.amount_ibo >= 0);
    if (!parsed.length) return 'Add at least level 1.';
    const levels = [...new Set(parsed.map((r) => r.level))].sort((a, b) => a - b);
    if (levels.length !== parsed.length) return 'Each level number can only appear once.';
    if (!flatOn) {
      if (levels[0] !== 1) return 'Reward levels must start at level 1.';
      return '';
    }
    const flatFrom = Number(flatFromRaw);
    const flatAmt = Number(flatAmtRaw);
    if (!Number.isFinite(flatFrom) || flatFrom < 2 || flatFrom > 20) {
      return 'Flat overflow must start at level 2 or higher (max 20).';
    }
    if (!Number.isFinite(flatAmt) || flatAmt < 0) return 'Flat overflow amount must be 0 or greater.';
    const required = Array.from({ length: flatFrom - 1 }, (_, i) => i + 1);
    const missing = required.filter((n) => !levels.includes(n));
    if (missing.length) {
      return `Configure every distinct level 1–${flatFrom - 1} before flat overflow. Missing: ${missing.join(', ')}.`;
    }
    const tooDeep = levels.filter((n) => n >= flatFrom);
    if (tooDeep.length) {
      return `Levels ${tooDeep.join(', ')} belong in flat overflow — remove them from distinct levels.`;
    }
    return '';
  }

  async function toggleEnabled() {
    await patchControls({ referral_enabled: !enabled });
  }

  async function saveLevels() {
    const err = validateLevelConfig(levelRows, flatEnabled, flatFromLevel, flatAmountIbo);
    if (err) {
      setLevelErr(err);
      return;
    }
    setLevelErr('');
    const referral_levels = levelRows
      .map((r) => ({ level: Number(r.level), amount_ibo: Number(r.amount_ibo) }))
      .filter((r) => Number.isFinite(r.level) && r.level >= 1 && Number.isFinite(r.amount_ibo) && r.amount_ibo >= 0);
    const payload = { referral_levels };
    if (flatEnabled) {
      payload.referral_flat_from_level = Number(flatFromLevel);
      payload.referral_flat_amount_ibo = Number(flatAmountIbo);
    } else {
      payload.referral_flat_from_level = 0;
      payload.referral_flat_amount_ibo = 0;
    }
    await patchControls(payload);
  }

  async function saveShareLinks() {
    await patchControls({
      referral_share_website_url: websiteUrl.trim(),
      referral_share_playstore_url: playstoreUrl.trim(),
    });
  }

  return (
    <AdminPanel
      title="Refer & Earn"
      subtitle="Multi-level referral rewards paid in Delta. A user is credited for every ancestor level once the referred user's KYC is approved. Level 1 = direct referral, level 2 = referral-of-referral, and so on."
    >
      <div className="flex items-center justify-between gap-4 mb-6 pb-5 border-b border-surface-border/70">
        <div>
          <p className="text-sm font-semibold text-white">Refer & Earn program</p>
          <p className="text-xs text-white/55 mt-0.5">When off, signup ignores referral codes and no new rewards are credited.</p>
        </div>
        <button
          type="button"
          onClick={toggleEnabled}
          disabled={busy}
          className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-40 ${enabled ? 'bg-gold/70' : 'bg-white/15'}`}
        >
          <span className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-6' : 'translate-x-1'}`} />
        </button>
      </div>

      <div className="mb-8">
        <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Reward levels</h3>
        <p className="text-xs text-white/55 mb-3 leading-relaxed">
          Configure distinct Delta amounts for levels 1, 2, 3, and so on. Optionally enable flat overflow below so every deeper level (4, 5, 6…) earns the same amount.
          If you only configure 3 levels without flat overflow, level 4+ ancestors are not tracked and earn nothing.
        </p>
        <div className="rounded-xl border border-surface-border/90 overflow-hidden bg-surface-dark/30">
          <div className="hidden sm:grid sm:grid-cols-[6rem_1fr_2.75rem] gap-2 px-3 py-2 bg-white/[0.06] text-xs font-bold text-white/60 uppercase tracking-wide border-b border-surface-border/80">
            <span>Level</span>
            <span>Amount (Delta)</span>
            <span className="sr-only">Remove</span>
          </div>
          <div className="p-3 space-y-2">
            {levelRows.map((row, idx) => (
              <div key={idx} className="grid sm:grid-cols-[6rem_1fr_2.75rem] gap-2 items-center">
                <input
                  type="number"
                  min="1"
                  max="20"
                  step="1"
                  placeholder="1"
                  value={row.level}
                  onChange={(e) => setLevelRows((rs) => rs.map((r, i) => (i === idx ? { ...r, level: e.target.value } : r)))}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
                />
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="Amount"
                  value={row.amount_ibo}
                  onChange={(e) => setLevelRows((rs) => rs.map((r, i) => (i === idx ? { ...r, amount_ibo: e.target.value } : r)))}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={() => setLevelRows((rs) => rs.filter((_, i) => i !== idx))}
                  className="p-2 rounded-xl border border-surface-border text-white/60 hover:text-red-300 hover:border-red-500/40 justify-self-end sm:justify-self-center"
                  title="Remove level"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            ))}
            <button
              type="button"
              onClick={() => setLevelRows((rs) => [...rs, { level: String(rs.length + 1), amount_ibo: '0' }])}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-surface-border text-xs font-bold text-white/80 hover:border-gold/40"
            >
              <Plus size={12} /> Add level
            </button>
          </div>
        </div>

        <div className="mt-5 rounded-xl border border-surface-border/90 bg-surface-dark/30 p-4">
          <div className="flex items-center justify-between gap-4 mb-3">
            <div>
              <p className="text-sm font-semibold text-white">Flat overflow rate</p>
              <p className="text-xs text-white/55 mt-0.5">
                From a chosen level onward, every deeper ancestor earns the same Delta. All distinct levels before it must be configured above.
              </p>
            </div>
            <button
              type="button"
              onClick={() => setFlatEnabled((v) => !v)}
              disabled={busy}
              className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors disabled:opacity-40 ${flatEnabled ? 'bg-gold/70' : 'bg-white/15'}`}
            >
              <span className={`inline-block h-5 w-5 rounded-full bg-white transition-transform ${flatEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
          </div>
          {flatEnabled ? (
            <div className="grid sm:grid-cols-2 gap-3">
              <label className="block">
                <span className="block text-xs font-semibold text-white/80 mb-1">From level</span>
                <input
                  type="number"
                  min="2"
                  max="20"
                  step="1"
                  value={flatFromLevel}
                  onChange={(e) => setFlatFromLevel(e.target.value)}
                  placeholder="4"
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
                />
              </label>
              <label className="block">
                <span className="block text-xs font-semibold text-white/80 mb-1">Amount for level N and deeper (Delta)</span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={flatAmountIbo}
                  onChange={(e) => setFlatAmountIbo(e.target.value)}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                />
              </label>
            </div>
          ) : null}
        </div>

        {levelErr ? <p className="text-red-400 text-sm mt-3">{levelErr}</p> : null}
        <button
          type="button"
          onClick={saveLevels}
          disabled={busy}
          className="mt-3 px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-40"
        >
          Save reward levels
        </button>
      </div>

      <div className="pt-5 border-t border-surface-border/70">
        <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Share links</h3>
        <p className="text-xs text-white/55 mb-3">
          Base URLs the app/website append <code className="text-white/70">?ref=&lt;code&gt;</code> to when a user taps Share.
          Website link is used on the exchange web app; the Play Store link is used inside the mobile app.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <label className="block">
            <span className="block text-sm font-semibold text-white mb-1">Website URL</span>
            <input
              type="text"
              value={websiteUrl}
              onChange={(e) => setWebsiteUrl(e.target.value)}
              placeholder="https://ibo.com/register"
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
            />
          </label>
          <label className="block">
            <span className="block text-sm font-semibold text-white mb-1">Play Store URL</span>
            <input
              type="text"
              value={playstoreUrl}
              onChange={(e) => setPlaystoreUrl(e.target.value)}
              placeholder="https://play.google.com/store/apps/details?id=..."
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={saveShareLinks}
          disabled={busy}
          className="mt-3 px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-40"
        >
          Save share links
        </button>
      </div>
    </AdminPanel>
  );
}

function AlertWebhookSection({ controls, patchControls, busy }) {
  const [url, setUrl] = useState('');
  const [minSev, setMinSev] = useState('warn');
  const [testing, setTesting] = useState(false);
  const [testMsg, setTestMsg] = useState('');

  useEffect(() => {
    if (!controls) return;
    setUrl(String(controls.alert_webhook_url || ''));
    setMinSev(String(controls.alert_webhook_min_severity || 'warn'));
  }, [controls]);

  async function save() {
    await patchControls({
      alert_webhook_url: url.trim(),
      alert_webhook_min_severity: minSev,
    });
  }

  async function sendTest() {
    setTesting(true);
    setTestMsg('');
    try {
      const res = await api.alertTest({ severity: minSev || 'warn' });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.detail || 'Test failed');
      const sent = body?.alert?.webhook_sent;
      const err = body?.alert?.webhook_error;
      setTestMsg(`Test alert emitted (${body?.alert?.id || '?'}). ${sent ? 'Webhook delivered successfully.' : err ? `Webhook failed: ${err}` : 'Webhook not configured - saved to DB only.'}`);
    } catch (e) {
      setTestMsg(`Test failed: ${e?.message || e}`);
    } finally {
      setTesting(false);
    }
  }

  return (
    <AdminPanel
      title="Alert webhooks"
      subtitle="Events are always stored in the database. Optionally forward them to Slack, Discord, PagerDuty, or another HTTPS endpoint."
    >
      <div className="flex items-start gap-3 mb-5 text-white/75 text-sm">
        <Bell className="shrink-0 text-gold-light/90 mt-0.5" size={18} />
        <p>
          Review the stream on the{' '}
          <Link to="/alerts" className="text-gold-light font-semibold hover:underline">Alerts</Link> page.
          Only events at or above the minimum severity are sent to the webhook; lower-severity rows stay in the database only.
        </p>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <label className="block sm:col-span-2">
          <span className="block text-sm font-semibold text-white mb-1">Webhook URL</span>
          <span className="block text-xs text-white/55 mb-2">Leave empty to disable outbound delivery.</span>
          <input
            type="text"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://hooks.slack.com/services/..."
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
          />
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-white mb-1">Minimum severity</span>
          <span className="block text-xs text-white/55 mb-2">Relay threshold</span>
          <select
            value={minSev}
            onChange={(e) => setMinSev(e.target.value)}
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="info">Information — all severities</option>
            <option value="warn">Warning — warnings and critical</option>
            <option value="critical">Critical — critical only</option>
          </select>
        </label>
      </div>

      <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 flex-wrap pt-4 border-t border-surface-border/70">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-40 shrink-0"
        >
          Save webhook settings
        </button>
        <button
          type="button"
          onClick={sendTest}
          disabled={busy || testing}
          className="px-4 py-2 rounded-xl border border-surface-border text-white/85 text-sm font-bold disabled:opacity-40 shrink-0"
        >
          {testing ? 'Sending…' : 'Send test alert'}
        </button>
        <p className="text-xs text-white/55 sm:ml-auto max-w-md">
          Superadmin only. Uses the real delivery pipeline so you can verify connectivity.
        </p>
      </div>
      {testMsg ? (
        <div className="mt-4 p-3 rounded-xl bg-white/[0.04] border border-surface-border text-sm text-white/80">
          {testMsg}
        </div>
      ) : null}
    </AdminPanel>
  );
}

function BinanceLiquidityGuardrailsSection({ controls, patchControls, busy }) {
  const [form, setForm] = useState({
    quoteStaleMs: '3000',
    lastLookBps: '30',
    latencyMs: '1500',
    cbFailureThreshold: '5',
    cbCooldownSec: '60',
  });

  useEffect(() => {
    if (!controls) return;
    setForm({
      quoteStaleMs: String(controls.binance_quote_stale_ms ?? 3000),
      lastLookBps: String(controls.binance_last_look_bps ?? 30),
      latencyMs: String(controls.binance_latency_threshold_ms ?? 1500),
      cbFailureThreshold: String(controls.binance_cb_failure_threshold ?? 5),
      cbCooldownSec: String(controls.binance_cb_cooldown_sec ?? 60),
    });
  }, [controls]);

  const onChange = (key, value) => setForm((v) => ({ ...v, [key]: value }));
  const num = (v) => Math.max(0, Number(v || 0));
  const intNum = (v) => Math.max(1, Math.floor(Number(v || 1)));
  const quoteStaleMsNum = num(form.quoteStaleMs);
  const lastLookBpsNum = num(form.lastLookBps);
  const latencyMsNum = num(form.latencyMs);
  const cbFailureThresholdNum = intNum(form.cbFailureThreshold);
  const cbCooldownSecNum = num(form.cbCooldownSec);

  const isQuoteStaleRisky = quoteStaleMsNum < 500 || quoteStaleMsNum > 10_000;
  const isLastLookRisky = lastLookBpsNum > 200;
  const isLatencyRisky = latencyMsNum < 100 || latencyMsNum > 5_000;
  const isCbFailureRisky = cbFailureThresholdNum <= 2 || cbFailureThresholdNum > 20;
  const isCbCooldownRisky = cbCooldownSecNum < 10 || cbCooldownSecNum > 600;

  const riskCount = [
    isQuoteStaleRisky,
    isLastLookRisky,
    isLatencyRisky,
    isCbFailureRisky,
    isCbCooldownRisky,
  ].filter(Boolean).length;

  async function save() {
    await patchControls({
      binance_quote_stale_ms: num(form.quoteStaleMs),
      binance_last_look_bps: num(form.lastLookBps),
      binance_latency_threshold_ms: num(form.latencyMs),
      binance_cb_failure_threshold: intNum(form.cbFailureThreshold),
      binance_cb_cooldown_sec: num(form.cbCooldownSec),
    });
  }

  return (
    <AdminPanel
      title="Binance liquidity guardrails"
      subtitle="Controls for quote freshness, last-look rejection, latency guard, and circuit breaker behavior."
    >
      <div className={`mb-4 rounded-xl border px-3 py-2 text-xs ${
        riskCount === 0
          ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100'
          : 'border-gold/30 bg-gold/10 text-gold-light/90'
      }`}>
        {riskCount === 0
          ? 'Guardrail profile looks healthy for production.'
          : `Guardrail profile has ${riskCount} risky value${riskCount > 1 ? 's' : ''}. Review highlighted fields before saving.`}
      </div>
      <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <label className={`block rounded-xl p-2 ${isQuoteStaleRisky ? 'border border-gold/30 bg-gold/5' : ''}`}>
          <span className="block text-sm font-semibold text-white mb-1">Quote stale threshold (ms)</span>
          <span className="block text-xs text-white/55 mb-2 font-mono">binance_quote_stale_ms (recommended: 1500-5000)</span>
          <input type="number" step="1" min="0" value={form.quoteStaleMs} onChange={(e) => onChange('quoteStaleMs', e.target.value)} className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white" />
          {isQuoteStaleRisky ? <p className="text-[11px] text-gold-light mt-1">Too strict causes false rejects; too high allows stale fills.</p> : null}
        </label>
        <label className={`block rounded-xl p-2 ${isLastLookRisky ? 'border border-gold/30 bg-gold/5' : ''}`}>
          <span className="block text-sm font-semibold text-white mb-1">Last-look reject threshold (bps)</span>
          <span className="block text-xs text-white/55 mb-2 font-mono">binance_last_look_bps (recommended: 10-100)</span>
          <input type="number" step="0.1" min="0" value={form.lastLookBps} onChange={(e) => onChange('lastLookBps', e.target.value)} className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white" />
          {isLastLookRisky ? <p className="text-[11px] text-gold-light mt-1">High value weakens last-look protection during fast moves.</p> : null}
        </label>
        <label className={`block rounded-xl p-2 ${isLatencyRisky ? 'border border-gold/30 bg-gold/5' : ''}`}>
          <span className="block text-sm font-semibold text-white mb-1">Latency guard threshold (ms)</span>
          <span className="block text-xs text-white/55 mb-2 font-mono">binance_latency_threshold_ms (recommended: 500-2500)</span>
          <input type="number" step="1" min="0" value={form.latencyMs} onChange={(e) => onChange('latencyMs', e.target.value)} className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white" />
          {isLatencyRisky ? <p className="text-[11px] text-gold-light mt-1">Very low blocks too often; very high accepts degraded connectivity.</p> : null}
        </label>
        <label className={`block rounded-xl p-2 ${isCbFailureRisky ? 'border border-gold/30 bg-gold/5' : ''}`}>
          <span className="block text-sm font-semibold text-white mb-1">Circuit breaker failure count</span>
          <span className="block text-xs text-white/55 mb-2 font-mono">binance_cb_failure_threshold (recommended: 3-10)</span>
          <input type="number" step="1" min="1" value={form.cbFailureThreshold} onChange={(e) => onChange('cbFailureThreshold', e.target.value)} className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white" />
          {isCbFailureRisky ? <p className="text-[11px] text-gold-light mt-1">Too low trips breaker on noise; too high delays protection.</p> : null}
        </label>
        <label className={`block rounded-xl p-2 ${isCbCooldownRisky ? 'border border-gold/30 bg-gold/5' : ''}`}>
          <span className="block text-sm font-semibold text-white mb-1">Circuit breaker cooldown (sec)</span>
          <span className="block text-xs text-white/55 mb-2 font-mono">binance_cb_cooldown_sec (recommended: 30-180)</span>
          <input type="number" step="1" min="0" value={form.cbCooldownSec} onChange={(e) => onChange('cbCooldownSec', e.target.value)} className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white" />
          {isCbCooldownRisky ? <p className="text-[11px] text-gold-light mt-1">Too short can flap; too long delays recovery after incidents.</p> : null}
        </label>
      </div>

      <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 pt-4 border-t border-surface-border/70">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-40 shrink-0"
        >
          Save guardrails
        </button>
        <p className="text-xs text-white/55">
          These settings affect BINANCE_BACKSTOP routing and retry worker execution safety checks.
        </p>
      </div>
    </AdminPanel>
  );
}

function BinanceLiquiditySection({ controls, patchControls, busy }) {
  const [enabled, setEnabled] = useState(false);
  const [liquidityMode, setLiquidityMode] = useState('HEDGE_ONLY');
  const [executionMode, setExecutionMode] = useState('dry_run');
  const [killSwitch, setKillSwitch] = useState(false);

  useEffect(() => {
    if (!controls) return;
    setEnabled(!!controls.binance_liquidity_enabled);
    setLiquidityMode(String(controls.liquidity_mode || 'HEDGE_ONLY').toUpperCase());
    setExecutionMode(String(controls.binance_execution_mode || 'dry_run').toLowerCase());
    setKillSwitch(!!controls.binance_kill_switch);
  }, [controls]);

  async function toggleEnabled() {
    const next = !enabled;
    setEnabled(next);
    await patchControls({ binance_liquidity_enabled: next });
  }

  async function savePolicy() {
    await patchControls({
      liquidity_mode: liquidityMode,
      binance_execution_mode: executionMode,
      binance_kill_switch: killSwitch,
    });
  }

  return (
    <AdminPanel
      title="Binance liquidity routing"
      subtitle="Enable or disable Binance backstop liquidity and control route behavior."
    >
      <div className="grid sm:grid-cols-2 gap-3 mb-5">
        <button
          type="button"
          onClick={toggleEnabled}
          disabled={busy}
          className={`text-left px-4 py-3 rounded-xl border transition-colors ${
            enabled
              ? 'border-emerald-500/35 bg-emerald-500/10'
              : 'border-red-500/35 bg-red-500/10'
          }`}
        >
          <p className="text-sm font-bold text-white">Binance Liquidity</p>
          <p className="text-xs text-white/70 mt-1 font-mono">binance_liquidity_enabled</p>
          <p className="text-sm mt-2 text-white/85">
            {enabled ? 'ON - remainder can route to Binance policy checks.' : 'OFF - Binance backstop is disabled.'}
          </p>
        </button>
        <label className="block rounded-xl border border-surface-border bg-surface-dark/40 px-4 py-3">
          <span className="block text-sm font-semibold text-white mb-1">Emergency kill switch</span>
          <span className="block text-xs text-white/55 mb-2 font-mono">binance_kill_switch</span>
          <select
            value={killSwitch ? 'on' : 'off'}
            onChange={(e) => setKillSwitch(e.target.value === 'on')}
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="off">Off (normal routing)</option>
            <option value="on">On (block all Binance routing)</option>
          </select>
        </label>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <label className="block">
          <span className="block text-sm font-semibold text-white mb-1">Liquidity mode</span>
          <span className="block text-xs text-white/55 mb-2 font-mono">liquidity_mode</span>
          <select
            value={liquidityMode}
            onChange={(e) => setLiquidityMode(e.target.value)}
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="OFF">OFF - reject market remainder</option>
            <option value="HEDGE_ONLY">HEDGE_ONLY - SYSTEM treasury only</option>
            <option value="BINANCE_BACKSTOP">BINANCE_BACKSTOP - allow Binance retry route</option>
          </select>
        </label>
        <label className="block">
          <span className="block text-sm font-semibold text-white mb-1">Binance execution mode</span>
          <span className="block text-xs text-white/55 mb-2 font-mono">binance_execution_mode</span>
          <select
            value={executionMode}
            onChange={(e) => setExecutionMode(e.target.value)}
            className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
          >
            <option value="dry_run">Dry run</option>
            <option value="shadow">Shadow</option>
            <option value="live">Live</option>
          </select>
        </label>
      </div>

      <div className="mt-5 flex flex-col sm:flex-row sm:items-center gap-3 pt-4 border-t border-surface-border/70">
        <button
          type="button"
          onClick={savePolicy}
          disabled={busy}
          className="px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-40 shrink-0"
        >
          Save Binance routing policy
        </button>
        <p className="text-xs text-white/55">
          Use this tab to operate Binance backstop independently from the hedger tab.
        </p>
      </div>
    </AdminPanel>
  );
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState('general');
  const [controls, setControls] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [limits, setLimits] = useState({
    maker_fee_rate: '0.001',
    taker_fee_rate: '0.001',
    withdraw_fee_rate: '0',
    withdraw_gas_fee_ibo: '0',
    gas_bsc: '',
    gas_eth: '',
    gas_tron: '',
    gas_btc: '',
    gas_solana: '',
    swap_fee_rate: '0.001',
    swap_fee_ibo_fixed: '0',
    withdraw_min_usdt: '0',
    withdraw_max_usdt: '0',
    withdraw_daily_limit_usdt: '0',
    withdrawal_auto_approve_limit_usdt: '0',
    deposit_min_confirmations: '0',
    // Phase 7b — rate-limit knobs. 0 disables the bucket entirely.
    rate_limit_login_per_ip_per_min: '5',
    rate_limit_login_per_email_per_hr: '10',
    rate_limit_register_per_ip_per_min: '5',
    rate_limit_2fa_per_uid_per_min: '10',
    rate_limit_withdraw_per_uid_per_min: '5',
    rate_limit_withdraw_per_uid_per_day: '30',
    // Phase 8 — Liquidity & risk
    system_spread_bps_default: '15',
    // Phase 5 — risk caps (USDT notionals)
    risk_max_order_notional_usdt: '0',
    risk_max_open_notional_usdt: '0',
  });
  // Phase 8 — per-symbol overrides edited as row arrays for ergonomics.
  const [spreadRows, setSpreadRows] = useState([]);
  const [limitRows, setLimitRows] = useState([]);
  const [orderCapRows, setOrderCapRows] = useState([]);
  const [openCapRows, setOpenCapRows] = useState([]);
  const [confirm, setConfirm] = useState({ open: false, type: '', key: '', enabled: false });

  // Coming Soon gate state
  const [csMessage,    setCsMessage]    = useState('');
  const [csLaunchDate, setCsLaunchDate] = useState('');
  const [csBusy,       setCsBusy]       = useState(false);
  const [csSaved,      setCsSaved]      = useState(false);
  const [csErr,        setCsErr]        = useState('');
  const [signupBonusIbo, setSignupBonusIbo] = useState('0');
  const [signupBonusBusy, setSignupBonusBusy] = useState(false);
  const [signupBonusSaved, setSignupBonusSaved] = useState(false);
  const [signupBonusErr, setSignupBonusErr] = useState('');
  const [smsDevOtpCode, setSmsDevOtpCode] = useState('123456');
  const [smsDevOtpBusy, setSmsDevOtpBusy] = useState(false);
  const [smsDevOtpSaved, setSmsDevOtpSaved] = useState(false);
  const [smsDevOtpErr, setSmsDevOtpErr] = useState('');

  const load = async () => {
    setErr('');
    try {
      const controlsRes = await api.platformControls();
      const controlsJson = await controlsRes.json().catch(() => ({}));
      if (!controlsRes.ok) throw new Error(controlsJson.detail || 'Could not load platform controls');
      setControls(controlsJson);
    } catch (e) {
      setErr(e.message);
      setControls(null);
    }
  };

  useEffect(() => {
    load();
  }, []);

  useEffect(() => {
    if (!controls) return;
    setLimits({
      maker_fee_rate: String(controls.maker_fee_rate ?? 0.001),
      taker_fee_rate: String(controls.taker_fee_rate ?? 0.001),
      withdraw_fee_rate: String(controls.withdraw_fee_rate ?? 0),
      withdraw_gas_fee_ibo: String(controls.withdraw_gas_fee_ibo ?? 0),
      gas_bsc: String((controls.withdraw_gas_fee_ibo_by_chain || {}).bsc ?? ''),
      gas_eth: String((controls.withdraw_gas_fee_ibo_by_chain || {}).eth ?? ''),
      gas_tron: String((controls.withdraw_gas_fee_ibo_by_chain || {}).tron ?? ''),
      gas_btc: String((controls.withdraw_gas_fee_ibo_by_chain || {}).btc ?? ''),
      gas_solana: String((controls.withdraw_gas_fee_ibo_by_chain || {}).solana ?? ''),
      swap_fee_rate: String(controls.swap_fee_rate ?? 0.001),
      swap_fee_ibo_fixed: String(controls.swap_fee_ibo_fixed ?? 0),
      withdraw_min_usdt: String(controls.withdraw_min_usdt ?? 0),
      withdraw_max_usdt: String(controls.withdraw_max_usdt ?? 0),
      withdraw_daily_limit_usdt: String(controls.withdraw_daily_limit_usdt ?? 0),
      withdrawal_auto_approve_limit_usdt: String(controls.withdrawal_auto_approve_limit_usdt ?? 0),
      deposit_min_confirmations: String(controls.deposit_min_confirmations ?? 0),
      rate_limit_login_per_ip_per_min: String(controls.rate_limit_login_per_ip_per_min ?? 5),
      rate_limit_login_per_email_per_hr: String(controls.rate_limit_login_per_email_per_hr ?? 10),
      rate_limit_register_per_ip_per_min: String(controls.rate_limit_register_per_ip_per_min ?? 5),
      rate_limit_2fa_per_uid_per_min: String(controls.rate_limit_2fa_per_uid_per_min ?? 10),
      rate_limit_withdraw_per_uid_per_min: String(controls.rate_limit_withdraw_per_uid_per_min ?? 5),
      rate_limit_withdraw_per_uid_per_day: String(controls.rate_limit_withdraw_per_uid_per_day ?? 30),
      system_spread_bps_default: String(controls.system_spread_bps_default ?? 15),
      risk_max_order_notional_usdt: String(controls.risk_max_order_notional_usdt ?? 0),
      risk_max_open_notional_usdt: String(controls.risk_max_open_notional_usdt ?? 0),
    });
    setSpreadRows(dictToRows(controls.system_spread_bps_by_symbol));
    setLimitRows(dictToRows(controls.treasury_inventory_limit_base_by_symbol));
    setOrderCapRows(dictToRows(controls.risk_max_order_notional_usdt_by_symbol));
    setOpenCapRows(dictToRows(controls.risk_max_open_notional_usdt_by_symbol));
    setCsMessage(controls.coming_soon_message || '');
    setCsLaunchDate(controls.coming_soon_launch_date || '');
    setSignupBonusIbo(String(controls.signup_bonus_ibo ?? 0));
    setSmsDevOtpCode(String(controls.sms_dev_otp_code ?? '123456'));
  }, [controls]);

  const patchControls = async (updates) => {
    setBusy(true);
    setErr('');
    try {
      const body = { ...updates };
      if (note.trim()) body.note = note.trim();
      const r = await api.patchPlatformControls(body);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not update platform controls');
      setControls(j);
      setNote('');
    } catch (ex) {
      setErr(ex.message);
    } finally {
      setBusy(false);
    }
  };

  const saveComingSoon = async () => {
    setCsBusy(true);
    setCsErr('');
    setCsSaved(false);
    try {
      const r = await api.patchPlatformControls({
        coming_soon_message:     csMessage,
        coming_soon_launch_date: csLaunchDate,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not save Coming Soon settings');
      setControls(j);
      setCsSaved(true);
      setTimeout(() => setCsSaved(false), 3000);
    } catch (ex) {
      setCsErr(ex.message);
    } finally {
      setCsBusy(false);
    }
  };

  const saveSmsDevOtp = async () => {
    setSmsDevOtpBusy(true);
    setSmsDevOtpErr('');
    setSmsDevOtpSaved(false);
    const code = String(smsDevOtpCode || '').trim();
    if (!/^\d{6}$/.test(code)) {
      setSmsDevOtpErr('Dev OTP must be exactly 6 digits');
      setSmsDevOtpBusy(false);
      return;
    }
    try {
      const r = await api.patchPlatformControls({
        sms_dev_otp_code: code,
        note: note || undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not save SMS dev OTP settings');
      setControls(j);
      setSmsDevOtpCode(String(j.sms_dev_otp_code ?? code));
      setSmsDevOtpSaved(true);
      setTimeout(() => setSmsDevOtpSaved(false), 3000);
    } catch (ex) {
      setSmsDevOtpErr(ex.message);
    } finally {
      setSmsDevOtpBusy(false);
    }
  };

  const saveSignupBonus = async () => {
    setSignupBonusBusy(true);
    setSignupBonusErr('');
    setSignupBonusSaved(false);
    const amount = Number(signupBonusIbo);
    if (!Number.isFinite(amount) || amount < 0) {
      setSignupBonusErr('Enter a valid amount (0 or greater)');
      setSignupBonusBusy(false);
      return;
    }
    try {
      const r = await api.patchPlatformControls({
        signup_bonus_ibo: amount,
        note: note || undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.detail || 'Could not save signup bonus');
      setControls(j);
      setSignupBonusIbo(String(j.signup_bonus_ibo ?? amount));
      setSignupBonusSaved(true);
      setTimeout(() => setSignupBonusSaved(false), 3000);
    } catch (ex) {
      setSignupBonusErr(ex.message);
    } finally {
      setSignupBonusBusy(false);
    }
  };

  const saveLimits = async () => {
    const num = (v) => Number(v || 0);
    const intNum = (v) => Math.max(0, Math.floor(Number(v || 0)));
    const byChain = {};
    for (const [key, chain] of [
      ['gas_bsc', 'bsc'],
      ['gas_eth', 'eth'],
      ['gas_tron', 'tron'],
      ['gas_btc', 'btc'],
      ['gas_solana', 'solana'],
    ]) {
      const raw = String(limits[key] ?? '').trim();
      if (raw === '') continue;
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) throw new Error(`Invalid ${chain} gas fee`);
      byChain[chain] = n;
    }
    await patchControls({
      maker_fee_rate: num(limits.maker_fee_rate),
      taker_fee_rate: num(limits.taker_fee_rate),
      withdraw_fee_rate: num(limits.withdraw_fee_rate),
      withdraw_gas_fee_ibo: num(limits.withdraw_gas_fee_ibo),
      withdraw_gas_fee_ibo_by_chain: byChain,
      swap_fee_rate: num(limits.swap_fee_rate),
      swap_fee_ibo_fixed: num(limits.swap_fee_ibo_fixed),
      withdraw_min_usdt: num(limits.withdraw_min_usdt),
      withdraw_max_usdt: num(limits.withdraw_max_usdt),
      withdraw_daily_limit_usdt: num(limits.withdraw_daily_limit_usdt),
      withdrawal_auto_approve_limit_usdt: num(limits.withdrawal_auto_approve_limit_usdt),
      deposit_min_confirmations: intNum(limits.deposit_min_confirmations),
      rate_limit_login_per_ip_per_min:    intNum(limits.rate_limit_login_per_ip_per_min),
      rate_limit_login_per_email_per_hr:  intNum(limits.rate_limit_login_per_email_per_hr),
      rate_limit_register_per_ip_per_min: intNum(limits.rate_limit_register_per_ip_per_min),
      rate_limit_2fa_per_uid_per_min:     intNum(limits.rate_limit_2fa_per_uid_per_min),
      rate_limit_withdraw_per_uid_per_min: intNum(limits.rate_limit_withdraw_per_uid_per_min),
      rate_limit_withdraw_per_uid_per_day: intNum(limits.rate_limit_withdraw_per_uid_per_day),
      system_spread_bps_default: num(limits.system_spread_bps_default),
      system_spread_bps_by_symbol: rowsToDict(spreadRows),
      treasury_inventory_limit_base_by_symbol: rowsToDict(limitRows),
      risk_max_order_notional_usdt: num(limits.risk_max_order_notional_usdt),
      risk_max_open_notional_usdt: num(limits.risk_max_open_notional_usdt),
      risk_max_order_notional_usdt_by_symbol: rowsToDict(orderCapRows),
      risk_max_open_notional_usdt_by_symbol: rowsToDict(openCapRows),
    });
  };

  return (
    <div className="admin-page space-y-6">
      <AdminPageHeader
        icon={Shield}
        iconClassName="text-gold-light"
        title="Platform settings"
        subtitle="Superadmin configuration: product switches, fees and limits, treasury spread, rate limits, hedging defaults, and alert webhooks."
        actions={(
          <div className="flex flex-wrap items-center gap-2">
            <Link
              to="/settings/landing-promo"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] border border-surface-border text-white/90 text-sm font-bold hover:border-gold/40"
            >
              <Sparkles size={16} className="text-gold-light" />
              Landing promo
            </Link>
            <Link
              to="/settings/app-home-banners"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] border border-surface-border text-white/90 text-sm font-bold hover:border-gold/40"
            >
              App home banners
            </Link>
            <Link
              to="/settings/mobile-app"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-white/[0.06] border border-surface-border text-white/90 text-sm font-bold hover:border-gold/40"
            >
              <Smartphone size={16} className="text-gold-light" />
              Mobile app (APK)
            </Link>
            <Link
              to="/settings/admin-create"
              className="inline-flex items-center px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold"
            >
              Create Admin
            </Link>
            <button
              type="button"
              onClick={load}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-surface-border text-white/90 text-sm font-bold"
            >
              <RefreshCw size={16} />
              Refresh
            </button>
          </div>
        )}
      />

      {err ? <p className="text-red-400 text-sm">{err}</p> : null}

      <div className="adm-table-x scrollbar-thin">
        <div className="admin-tabs w-max min-w-full">
          {SETTINGS_TABS.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`admin-tab-btn shrink-0 ${activeTab === tab.id ? 'active' : ''}`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {activeTab === 'general' ? (
        <>

        {/* ── OTP Services ──────────────────────────────────────────────── */}
        <AdminPanel
          title="OTP Services"
          subtitle="Control whether email and SMS one-time-password verification is required during signup. Turning a service OFF lets users register without that verification step — they can verify later from their profile."
          className="mb-6"
        >
          {!controls ? (
            <p className="text-white/55 text-sm">Loading…</p>
          ) : (
            <div className="grid sm:grid-cols-2 gap-4">

              {/* Email OTP */}
              <div className={`flex items-start gap-4 rounded-xl border px-5 py-4 ${
                controls.email_otp_service_enabled !== false
                  ? 'border-emerald-500/35 bg-emerald-500/10'
                  : 'border-gold/35 bg-gold/10'
              }`}>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm">Email OTP verification</p>
                  <p className="text-xs text-white/60 mt-1 leading-relaxed">
                    When <strong className="text-white/90">ON</strong>, users must verify their email with a code during signup.
                    When <strong className="text-white/90">OFF</strong>, the email OTP step is skipped entirely — email is accepted without verification.
                  </p>
                  <p className={`text-xs font-bold mt-2 ${controls.email_otp_service_enabled !== false ? 'text-emerald-300' : 'text-gold-light'}`}>
                    {controls.email_otp_service_enabled !== false
                      ? '✓ Email OTP active — verification required on signup'
                      : '⚠ Email OTP off — signup accepts email without verification'}
                  </p>
                  <p className="text-[10px] font-mono text-white/35 mt-2">email_otp_service_enabled</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm({
                    open: true,
                    type: 'toggle',
                    key: 'email_otp_service_enabled',
                    enabled: controls.email_otp_service_enabled === false,
                  })}
                  style={{
                    flexShrink: 0, width: 48, height: 26, position: 'relative',
                    borderRadius: 9999, border: 'none', cursor: 'pointer',
                    transition: 'background 0.2s',
                    background: controls.email_otp_service_enabled !== false ? '#10b981' : 'rgba(255,255,255,0.15)',
                    padding: 0,
                  }}
                  aria-checked={controls.email_otp_service_enabled !== false}
                  role="switch"
                >
                  <span style={{
                    display: 'block', position: 'absolute', top: 3,
                    left: controls.email_otp_service_enabled !== false ? 25 : 3,
                    width: 20, height: 20, borderRadius: '50%', background: '#fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.35)', transition: 'left 0.2s',
                  }} />
                </button>
              </div>

              {/* SMS OTP */}
              <div className={`flex items-start gap-4 rounded-xl border px-5 py-4 ${
                controls.sms_otp_service_enabled !== false
                  ? 'border-emerald-500/35 bg-emerald-500/10'
                  : 'border-gold/35 bg-gold/10'
              }`}>
                <div className="flex-1 min-w-0">
                  <p className="font-bold text-white text-sm">SMS OTP verification</p>
                  <p className="text-xs text-white/60 mt-1 leading-relaxed">
                    When <strong className="text-white/90">ON</strong>, users must enter a phone number and verify it via SMS during signup.
                    When <strong className="text-white/90">OFF</strong>, the phone number step is hidden entirely — no SMS is sent.
                  </p>
                  <p className={`text-xs font-bold mt-2 ${controls.sms_otp_service_enabled !== false ? 'text-emerald-300' : 'text-gold-light'}`}>
                    {controls.sms_otp_service_enabled !== false
                      ? '✓ SMS OTP active — phone verification required on signup'
                      : '⚠ SMS OTP off — phone number step hidden during signup'}
                  </p>
                  <p className="text-[10px] font-mono text-white/35 mt-2">sms_otp_service_enabled</p>
                </div>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setConfirm({
                    open: true,
                    type: 'toggle',
                    key: 'sms_otp_service_enabled',
                    enabled: controls.sms_otp_service_enabled === false,
                  })}
                  style={{
                    flexShrink: 0, width: 48, height: 26, position: 'relative',
                    borderRadius: 9999, border: 'none', cursor: 'pointer',
                    transition: 'background 0.2s',
                    background: controls.sms_otp_service_enabled !== false ? '#10b981' : 'rgba(255,255,255,0.15)',
                    padding: 0,
                  }}
                  aria-checked={controls.sms_otp_service_enabled !== false}
                  role="switch"
                >
                  <span style={{
                    display: 'block', position: 'absolute', top: 3,
                    left: controls.sms_otp_service_enabled !== false ? 25 : 3,
                    width: 20, height: 20, borderRadius: '50%', background: '#fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.35)', transition: 'left 0.2s',
                  }} />
                </button>
              </div>

            </div>
          )}
        </AdminPanel>

        {/* ── Coming Soon Gate ──────────────────────────────────────────── */}
        <AdminPanel
          title="Coming Soon — Launch Gate"
          subtitle="When enabled, every visitor sees only the Coming Soon page. No other pages are accessible until you turn this off."
          className="mb-6"
        >
          {!controls ? (
            <p className="text-white/55 text-sm">Loading…</p>
          ) : (
            <div className="space-y-5">
              {/* Master toggle */}
              <div className={`flex items-start gap-4 rounded-xl border px-5 py-4 ${
                controls.coming_soon_enabled
                  ? 'border-gold/40 bg-gold/10'
                  : 'border-surface-border bg-surface-dark'
              }`}>
                <div className="flex-1">
                  <p className="font-bold text-white text-sm">Coming Soon mode</p>
                  <p className="text-xs text-white/60 mt-1 leading-relaxed">
                    When <strong className="text-white/90">ON</strong>, all exchange routes are hidden and visitors only see the Coming Soon page.
                    Turn <strong className="text-white/90">OFF</strong> to open the exchange publicly.
                  </p>
                  <p className={`text-xs font-bold mt-2 ${controls.coming_soon_enabled ? 'text-gold-light' : 'text-emerald-400'}`}>
                    {controls.coming_soon_enabled ? '⚠ Exchange is gated — only Coming Soon visible' : '✓ Exchange is open to the public'}
                  </p>
                </div>
                {/* Toggle switch */}
                <button
                  type="button"
                  disabled={busy || csBusy}
                  onClick={() => setConfirm({
                    open: true,
                    type: 'toggle',
                    key: 'coming_soon_enabled',
                    enabled: !controls.coming_soon_enabled,
                  })}
                  style={{ flexShrink: 0, width: 48, height: 26, position: 'relative', borderRadius: 9999, border: 'none', cursor: 'pointer', transition: 'background 0.2s', background: controls.coming_soon_enabled ? '#FE6C02' : 'rgba(255,255,255,0.15)', padding: 0 }}
                  aria-checked={!!controls.coming_soon_enabled}
                  role="switch"
                >
                  <span style={{
                    display: 'block',
                    position: 'absolute',
                    top: 3,
                    left: controls.coming_soon_enabled ? 25 : 3,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>

              {/* Message & launch date */}
              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-white/70 mb-1.5">
                    Custom message <span className="text-white/35">(optional)</span>
                  </label>
                  <textarea
                    value={csMessage}
                    onChange={(e) => setCsMessage(e.target.value)}
                    rows={3}
                    placeholder="We're almost ready! Stay tuned for the official launch."
                    className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white resize-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-white/70 mb-1.5">
                    Launch date / time <span className="text-white/35">(optional — drives countdown clock)</span>
                  </label>
                  <input
                    type="datetime-local"
                    value={csLaunchDate}
                    onChange={(e) => setCsLaunchDate(e.target.value)}
                    className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                  />
                  <p className="text-[11px] text-white/40 mt-1.5">Leave blank to hide the countdown timer on the page.</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={csBusy || busy}
                  onClick={saveComingSoon}
                  className="px-5 py-2 rounded-xl bg-gold text-surface-dark font-bold text-sm hover:bg-gold/90 transition-colors disabled:opacity-50"
                >
                  {csBusy ? 'Saving…' : 'Save message & date'}
                </button>
                {csSaved && (
                  <span className="text-emerald-400 text-sm font-semibold flex items-center gap-1">
                    ✓ Saved — page will update within 30 seconds
                  </span>
                )}
                {csErr && (
                  <span className="text-red-400 text-sm">{csErr}</span>
                )}
              </div>
            </div>
          )}
        </AdminPanel>

        <AdminPanel
          title="Signup bonus"
          subtitle="Delta sent on-chain from the treasury cold wallet (TREASURY_COLD_PRIVATE_KEY) to each new user's BEP-20 deposit address. Tracked like a deposit — pending in history until confirmations and KYC (when enabled)."
        >
          {!controls ? (
            <p className="text-white/55 text-sm">Loading…</p>
          ) : (
            <div className="space-y-4 max-w-xl">
              <p className="text-xs text-white/55 leading-relaxed">
                Set to <strong className="text-white/80">0</strong> to disable. Requires{' '}
                <code className="text-[#FE9D55]/90 text-[11px]">TREASURY_ETH_PRIVATE_KEY</code>,{' '}
                <code className="text-[#FE9D55]/90 text-[11px]">IBO_CONTRACT_ADDRESS</code>, and{' '}
                <code className="text-[#FE9D55]/90 text-[11px]">QUICKNODE_BSC_URL</code>. Users see the transfer in Wallet history;
                balance credits after RPC confirmations and KYC approval.
              </p>
              <label className="block">
                <span className="block text-sm font-semibold text-white">Bonus amount (Delta)</span>
                <span className="block text-xs text-white/55 mt-0.5 mb-2">
                  On-chain transfer to the user&apos;s BNB Chain deposit address (same pipeline as deposits).
                </span>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={signupBonusIbo}
                  onChange={(e) => setSignupBonusIbo(e.target.value)}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-sm text-white font-mono"
                />
              </label>
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={signupBonusBusy || busy}
                  onClick={saveSignupBonus}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gold text-surface-dark font-bold text-sm hover:bg-gold/90 transition-colors disabled:opacity-50"
                >
                  <Gift size={16} />
                  {signupBonusBusy ? 'Saving…' : 'Save signup bonus'}
                </button>
                {signupBonusSaved && (
                  <span className="text-emerald-400 text-sm font-semibold">Saved — applies to new registrations</span>
                )}
                {signupBonusErr && (
                  <span className="text-red-400 text-sm">{signupBonusErr}</span>
                )}
              </div>
              {Number(controls.signup_bonus_ibo) > 0 ? (
                <p className="text-xs text-gold-light/90 bg-gold/10 border border-gold/25 rounded-xl px-4 py-3">
                  Active: new users receive <strong>{Number(controls.signup_bonus_ibo).toLocaleString()} Delta</strong> on-chain from the cold treasury wallet (pending until KYC if enabled). Monitor balances on <strong>Admin wallet</strong>.
                </p>
              ) : (
                <p className="text-xs text-white/45 bg-white/[0.03] border border-white/10 rounded-xl px-4 py-3">
                  Signup bonus is off — new users receive no on-chain Delta bonus.
                </p>
              )}
            </div>
          )}
        </AdminPanel>

        <AdminPanel
          title="SMS verification — dev OTP"
          subtitle="Use a fixed OTP for signup and profile phone changes in staging. When enabled, AuthKey SMS is skipped and every user receives the code below."
        >
          {!controls ? (
            <p className="text-white/55 text-sm">Loading…</p>
          ) : (
            <div className="space-y-4 max-w-xl">
              <div className={`flex items-start gap-4 rounded-xl border px-5 py-4 ${
                controls.sms_dev_otp_enabled
                  ? 'border-gold/40 bg-gold/10'
                  : 'border-surface-border bg-surface-dark'
              }`}>
                <div className="flex-1">
                  <p className="font-bold text-white text-sm">Dev OTP mode</p>
                  <p className="text-xs text-white/60 mt-1 leading-relaxed">
                    When <strong className="text-white/90">ON</strong>, no real SMS is sent — users enter the fixed code below.
                    When <strong className="text-white/90">OFF</strong>, OTPs are sent via AuthKey (requires API credentials in server .env).
                  </p>
                  <p className={`text-xs font-bold mt-2 ${controls.sms_dev_otp_enabled ? 'text-gold-light' : 'text-emerald-400'}`}>
                    {controls.sms_dev_otp_enabled
                      ? '⚠ Dev mode active — AuthKey SMS disabled'
                      : '✓ Production mode — AuthKey SMS when configured'}
                  </p>
                </div>
                <button
                  type="button"
                  disabled={busy || smsDevOtpBusy}
                  onClick={() => setConfirm({
                    open: true,
                    type: 'toggle',
                    key: 'sms_dev_otp_enabled',
                    enabled: !controls.sms_dev_otp_enabled,
                  })}
                  style={{ flexShrink: 0, width: 48, height: 26, position: 'relative', borderRadius: 9999, border: 'none', cursor: 'pointer', transition: 'background 0.2s', background: controls.sms_dev_otp_enabled ? '#FE6C02' : 'rgba(255,255,255,0.15)', padding: 0 }}
                  aria-checked={!!controls.sms_dev_otp_enabled}
                  role="switch"
                >
                  <span style={{
                    display: 'block',
                    position: 'absolute',
                    top: 3,
                    left: controls.sms_dev_otp_enabled ? 25 : 3,
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    background: '#fff',
                    boxShadow: '0 1px 4px rgba(0,0,0,0.35)',
                    transition: 'left 0.2s',
                  }} />
                </button>
              </div>

              <label className="block">
                <span className="block text-sm font-semibold text-white">Fixed dev OTP</span>
                <span className="block text-xs text-white/55 mt-0.5 mb-2">
                  Six digits used for all SMS verification while dev mode is on. Default: 123456.
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={smsDevOtpCode}
                  onChange={(e) => setSmsDevOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  className="w-full max-w-[12rem] rounded-xl bg-surface-dark border border-surface-border px-3 py-2.5 text-sm text-white font-mono tracking-widest"
                />
              </label>

              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  disabled={smsDevOtpBusy || busy}
                  onClick={saveSmsDevOtp}
                  className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gold text-surface-dark font-bold text-sm hover:bg-gold/90 transition-colors disabled:opacity-50"
                >
                  <MessageSquare size={16} />
                  {smsDevOtpBusy ? 'Saving…' : 'Save dev OTP code'}
                </button>
                {smsDevOtpSaved && (
                  <span className="text-emerald-400 text-sm font-semibold">Saved</span>
                )}
                {smsDevOtpErr && (
                  <span className="text-red-400 text-sm">{smsDevOtpErr}</span>
                )}
              </div>
            </div>
          )}
        </AdminPanel>

        <BlockchainRpcSection controls={controls} patchControls={patchControls} busy={busy} />
        <RpcUsagePanel />

        <AdminPanel
          title="Feature switches"
          subtitle="Each control applies platform-wide. Maintenance mode overrides the other flags for customers."
        >
          {!controls ? (
            <p className="text-white/55 text-sm">Loading platform controls…</p>
          ) : (
            <>
              <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {PLATFORM_FEATURES.map(({ key: k, title, description, inverted }) => {
                  const enabled = !!controls[k];
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={busy}
                      onClick={() => setConfirm({ open: true, type: 'toggle', key: k, enabled: !enabled })}
                      className={`text-left rounded-xl border px-4 py-3 transition-colors ${
                        enabled
                          ? (inverted ? 'border-red-500/35 bg-red-500/10' : 'border-emerald-500/35 bg-emerald-500/10')
                          : 'border-surface-border bg-surface-dark'
                      }`}
                    >
                      <p className="text-sm font-bold text-white">{title}</p>
                      {description ? (
                        <p className="text-xs text-white/65 mt-1.5 leading-relaxed">{description}</p>
                      ) : null}
                      <p className={`text-xs font-semibold mt-2 ${inverted && enabled ? 'text-gold-light' : 'text-[#FE9D55]/90'}`}>
                        {platformSwitchStatus(k, enabled)}
                      </p>
                      <p className="text-[10px] font-mono text-white/40 mt-2 truncate" title={k}>{k}</p>
                    </button>
                  );
                })}
              </div>
              <div className="mt-5 flex flex-col sm:flex-row gap-3 pt-4 border-t border-surface-border/70">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Optional audit note (stored with the next change)"
                  className="flex-1 min-w-0 rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                />
                <button
                  type="button"
                  onClick={load}
                  className="px-4 py-2 rounded-xl border border-surface-border text-white/85 text-sm font-bold shrink-0"
                >
                  Reload from server
                </button>
              </div>
            </>
          )}
        </AdminPanel>
        <AdminPanel
          title="Phase 4 — On-chain deposit pipeline"
          subtitle="Sighting (poller) → confirmations → balance credit (crediter). Independent of Phase 3 treasury sweeps to hot."
          className="mt-6"
        >
          <ul className="text-sm text-white/75 space-y-2 list-disc list-inside max-w-3xl">
            <li>
              <strong className="text-white/90">API process env:</strong>{' '}
              <code className="text-[#FE9D55]/90 text-xs">DEPOSIT_POLL_ENABLED=true</code>
              {' '}and{' '}
              <code className="text-[#FE9D55]/90 text-xs">DEPOSIT_CREDIT_ENABLED=true</code>
              {' '}so both background tasks attach at startup (with a real blockchain provider).
            </li>
            <li>
              <strong className="text-white/90">This panel:</strong> turn on <strong>Auto-credit deposits</strong> above so
              the crediter may post credits after the configured confirmation threshold.
            </li>
            <li>
              Users see rows and confirmation progress under Wallet → History → Deposits; balances increase when status becomes credited.
            </li>
            <li>
              <strong className="text-white/90">Admin:</strong> use <strong className="text-white">Deposit events</strong> in the sidebar (Phase 5) for a global filtered queue and optional manual credit (requires <code className="text-[#FE9D55]/90 text-xs">manage_treasury</code>).
            </li>
          </ul>
        </AdminPanel>
        </>
      ) : null}

      {activeTab === 'limits' ? (
      <AdminPanel
        title="Fees, withdrawals, and deposits"
        subtitle="Rates are percentages of trade or withdrawal notional. Settlement is always in Delta from the user’s spot wallet (except legacy in-flight withdrawals)."
      >
        <div className="space-y-8">
          <p className="text-xs text-[#FE9D55]/90 bg-[#FE6C02]/10 border border-[#FE6C02]/25 rounded-xl px-4 py-3 leading-relaxed">
            <strong className="text-white/95">Delta fee settlement:</strong> Spot maker/taker, futures, and options trading fees are charged in Delta.
            Withdrawal platform fee and gas fee below are also deducted in Delta. Users need sufficient Delta before trading or withdrawing.
            Futures/options global rates are edited on their overview pages; spot uses the fields here.
          </p>
          <div>
            <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Spot trading fees (settled in Delta)</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              {[
                ['maker_fee_rate', 'Maker fee rate', 'Decimal (0.001 = 0.1%). % of fill notional — debited in Delta on maker fills.'],
                ['taker_fee_rate', 'Taker fee rate', 'Decimal (0.001 = 0.1%). % of fill notional — debited in Delta on taker fills.'],
              ].map(([key, title, hint]) => (
                <label key={key} className="block">
                  <span className="block text-sm font-semibold text-white">{title}</span>
                  <span className="block text-xs text-white/55 mt-0.5 mb-2">{hint}</span>
                  <input
                    type="number"
                    step="0.00000001"
                    min="0"
                    value={limits[key]}
                    onChange={(e) => setLimits((v) => ({ ...v, [key]: e.target.value }))}
                    className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Delta ↔ USDT swap fees (Delta)</h3>
            <p className="text-xs text-white/55 mb-3 leading-relaxed">
              Charged when users swap in Wallet. Percent applies to swap USDT notional; flat Delta is added per swap.
              Users also need Delta for the underlying market-order trading fee (taker rate above).
            </p>
            <div className="grid sm:grid-cols-2 gap-4 mb-8">
              {[
                ['swap_fee_rate', 'Swap fee rate', 'Decimal (0.001 = 0.1% of swap USDT notional). Debited in Delta on execute. 0 = rate off.'],
                ['swap_fee_ibo_fixed', 'Swap flat fee (Delta)', 'Fixed Delta per swap (added to rate-based fee). 0 = disabled.'],
              ].map(([key, title, hint]) => (
                <label key={key} className="block">
                  <span className="block text-sm font-semibold text-white">{title}</span>
                  <span className="block text-xs text-white/55 mt-0.5 mb-2">{hint}</span>
                  <input
                    type="number"
                    step="0.00000001"
                    min="0"
                    value={limits[key]}
                    onChange={(e) => setLimits((v) => ({ ...v, [key]: e.target.value }))}
                    className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Withdrawal rules (Delta fees)</h3>
            <p className="text-xs text-white/55 mb-3 max-w-3xl">
              These admin values are the only Delta fees charged on crypto withdrawals. 0 = no fee (no hidden defaults).
            </p>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                ['withdraw_fee_rate', 'Withdrawal platform fee rate', 'Fraction of withdrawal USDT notional (e.g. 0.001 = 0.1%). Converted to Delta and debited from spot Delta. 0 = off.'],
                ['withdraw_gas_fee_ibo', 'Default gas fee (Delta)', 'Used when a chain has no override. User always pays Delta; platform pays BNB/ETH/TRX on-chain. 0 = no gas fee.'],
                ['gas_bsc', 'BSC gas fee (Delta)', 'Override for BEP-20 / BNB Chain. Blank = use default gas fee.'],
                ['gas_eth', 'Ethereum gas fee (Delta)', 'Override for ERC-20. Blank = use default gas fee.'],
                ['gas_tron', 'Tron gas fee (Delta)', 'Override for TRC-20. Blank = use default gas fee.'],
                ['gas_btc', 'Bitcoin gas fee (Delta)', 'Override for BTC network. Blank = use default gas fee.'],
                ['gas_solana', 'Solana gas fee (Delta)', 'Override for Solana. Blank = use default gas fee.'],
                ['withdraw_min_usdt', 'Minimum withdrawal (USDT)', '0 = no minimum.'],
                ['withdraw_max_usdt', 'Maximum withdrawal (USDT)', '0 = no maximum.'],
                ['withdraw_daily_limit_usdt', 'Daily limit per user (USDT)', '0 = no daily cap.'],
                ['withdrawal_auto_approve_limit_usdt', 'Auto-approve threshold (USDT)', 'Requests at or below this notional can auto-approve when automation is on. 0 = disabled.'],
              ].map(([key, title, hint]) => (
                <label key={key} className="block">
                  <span className="block text-sm font-semibold text-white">{title}</span>
                  <span className="block text-xs text-white/55 mt-0.5 mb-2">{hint}</span>
                  <input
                    type="number"
                    step="0.00000001"
                    min="0"
                    value={limits[key]}
                    onChange={(e) => setLimits((v) => ({ ...v, [key]: e.target.value }))}
                    className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                  />
                </label>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Deposits</h3>
            <label className="block max-w-md">
              <span className="block text-sm font-semibold text-white">Minimum confirmations (auto-credit)</span>
              <span className="block text-xs text-white/55 mt-0.5 mb-2">0 uses each asset’s default from configuration.</span>
              <input
                type="number"
                step="1"
                min="0"
                value={limits.deposit_min_confirmations}
                onChange={(e) => setLimits((v) => ({ ...v, deposit_min_confirmations: e.target.value }))}
                className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
              />
            </label>
          </div>
        </div>

        <div className="mt-6 flex flex-col sm:flex-row sm:items-center gap-3 pt-4 border-t border-surface-border/70">
          <button
            type="button"
            onClick={() => setConfirm({ open: true, type: 'limits', key: '', enabled: false })}
            disabled={busy}
            className="px-4 py-2 rounded-xl bg-gold/20 border border-gold/35 text-gold-light text-sm font-bold disabled:opacity-40 shrink-0"
          >
            Save fees and limits
          </button>
          <p className="text-xs text-white/55">
            Applies to new trades and withdrawals. Already submitted requests keep their original calculations.
          </p>
        </div>
      </AdminPanel>
      ) : null}

      {activeTab === 'limits' ? (
      <AdminPanel
        title="Treasury spread and risk caps"
        subtitle="How the platform prices residual fills, caps inventory, and limits order and position size in USDT terms."
      >
        <ul className="list-disc pl-5 text-sm text-white/75 space-y-1.5 mb-6 max-w-3xl">
          <li>When system treasury liquidity is enabled, unmatched market size can be filled internally; the default spread (basis points) is added on the customer side and captured as treasury revenue.</li>
          <li>Per-pair inventory caps (base units) stop unlimited accumulation; when a cap is hit, remaining size is returned to the user.</li>
          <li>Global and per-symbol USDT notionals cap single orders and open exposure for risk control.</li>
        </ul>

        <div className="max-w-md mb-8">
          <label className="block">
            <span className="block text-sm font-semibold text-white">Default internal spread</span>
            <span className="block text-xs text-white/55 mt-0.5 mb-2">Basis points (bps) applied when no per-pair override exists.</span>
            <input
              type="number"
              step="0.1"
              min="0"
              value={limits.system_spread_bps_default}
              onChange={(e) => setLimits((v) => ({ ...v, system_spread_bps_default: e.target.value }))}
              className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
            />
          </label>
        </div>

        <div className="space-y-8">
          <div>
            <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Per-pair spread overrides</h3>
            <div className="rounded-xl border border-surface-border/90 overflow-hidden bg-surface-dark/30">
              <div className="hidden sm:grid sm:grid-cols-[1fr_7rem_2.75rem] gap-2 px-3 py-2 bg-white/[0.06] text-xs font-bold text-white/60 uppercase tracking-wide border-b border-surface-border/80">
                <span>Pair</span>
                <span className="text-right pr-1">Spread (bps)</span>
                <span className="sr-only">Remove</span>
              </div>
              <div className="p-3 space-y-2">
                {spreadRows.length === 0 && (
                  <p className="text-white/50 text-sm">No overrides — all pairs use {limits.system_spread_bps_default || 0} bps.</p>
                )}
                {spreadRows.map((row, idx) => (
                  <div key={idx} className="grid sm:grid-cols-[1fr_7rem_2.75rem] gap-2 items-center">
                    <input
                      placeholder="e.g. ETHUSDT"
                      value={row.symbol}
                      onChange={(e) => setSpreadRows((rs) => rs.map((r, i) => (i === idx ? { ...r, symbol: e.target.value.toUpperCase() } : r)))}
                      className="min-w-0 rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
                    />
                    <input
                      type="number"
                      step="0.1"
                      min="0"
                      placeholder="bps"
                      value={row.value}
                      onChange={(e) => setSpreadRows((rs) => rs.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
                      className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setSpreadRows((rs) => rs.filter((_, i) => i !== idx))}
                      className="p-2 rounded-xl border border-surface-border text-white/60 hover:text-red-300 hover:border-red-500/40 justify-self-end sm:justify-self-center"
                      title="Remove row"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setSpreadRows((rs) => [...rs, { symbol: '', value: '' }])}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-surface-border text-xs font-bold text-white/80 hover:border-gold/40"
                >
                  <Plus size={12} /> Add row
                </button>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Per-pair inventory caps</h3>
            <p className="text-xs text-white/55 mb-3">Maximum base-asset inventory the treasury may hold per pair (e.g. BTC in BTCUSDT).</p>
            <div className="rounded-xl border border-surface-border/90 overflow-hidden bg-surface-dark/30">
              <div className="hidden sm:grid sm:grid-cols-[1fr_8rem_2.75rem] gap-2 px-3 py-2 bg-white/[0.06] text-xs font-bold text-white/60 uppercase tracking-wide border-b border-surface-border/80">
                <span>Pair</span>
                <span className="text-right pr-1">Cap (base)</span>
                <span className="sr-only">Remove</span>
              </div>
              <div className="p-3 space-y-2">
                {limitRows.length === 0 && (
                  <p className="text-white/50 text-sm">No caps configured — exposure is uncapped until you add rows.</p>
                )}
                {limitRows.map((row, idx) => (
                  <div key={idx} className="grid sm:grid-cols-[1fr_8rem_2.75rem] gap-2 items-center">
                    <input
                      placeholder="e.g. BTCUSDT"
                      value={row.symbol}
                      onChange={(e) => setLimitRows((rs) => rs.map((r, i) => (i === idx ? { ...r, symbol: e.target.value.toUpperCase() } : r)))}
                      className="min-w-0 rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
                    />
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      placeholder="Amount"
                      value={row.value}
                      onChange={(e) => setLimitRows((rs) => rs.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
                      className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                    />
                    <button
                      type="button"
                      onClick={() => setLimitRows((rs) => rs.filter((_, i) => i !== idx))}
                      className="p-2 rounded-xl border border-surface-border text-white/60 hover:text-red-300 hover:border-red-500/40 justify-self-end sm:justify-self-center"
                      title="Remove row"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() => setLimitRows((rs) => [...rs, { symbol: '', value: '' }])}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-surface-border text-xs font-bold text-white/80 hover:border-gold/40"
                >
                  <Plus size={12} /> Add row
                </button>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Global risk caps (USDT)</h3>
            <div className="grid sm:grid-cols-2 gap-4">
              <label className="block">
                <span className="block text-sm font-semibold text-white">Max single-order notional</span>
                <span className="block text-xs text-white/55 mt-0.5 mb-2">0 = disabled (no global cap).</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={limits.risk_max_order_notional_usdt}
                  onChange={(e) => setLimits((v) => ({ ...v, risk_max_order_notional_usdt: e.target.value }))}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                />
              </label>
              <label className="block">
                <span className="block text-sm font-semibold text-white">Max open exposure per pair</span>
                <span className="block text-xs text-white/55 mt-0.5 mb-2">0 = disabled.</span>
                <input
                  type="number"
                  step="0.0001"
                  min="0"
                  value={limits.risk_max_open_notional_usdt}
                  onChange={(e) => setLimits((v) => ({ ...v, risk_max_open_notional_usdt: e.target.value }))}
                  className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                />
              </label>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Per-pair order caps (USDT)</h3>
            <div className="rounded-xl border border-surface-border/90 overflow-hidden bg-surface-dark/30">
              <div className="hidden sm:grid sm:grid-cols-[1fr_8rem_2.75rem] gap-2 px-3 py-2 bg-white/[0.06] text-xs font-bold text-white/60 uppercase tracking-wide border-b border-surface-border/80">
                <span>Pair</span>
                <span className="text-right pr-1">Max order</span>
                <span className="sr-only">Remove</span>
              </div>
              <div className="p-3 space-y-2">
                {orderCapRows.length === 0 && <p className="text-white/50 text-sm">No per-pair order caps.</p>}
                {orderCapRows.map((row, idx) => (
                  <div key={idx} className="grid sm:grid-cols-[1fr_8rem_2.75rem] gap-2 items-center">
                    <input
                      placeholder="e.g. ETHUSDT"
                      value={row.symbol}
                      onChange={(e) => setOrderCapRows((rs) => rs.map((r, i) => (i === idx ? { ...r, symbol: e.target.value.toUpperCase() } : r)))}
                      className="min-w-0 rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
                    />
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      placeholder="USDT"
                      value={row.value}
                      onChange={(e) => setOrderCapRows((rs) => rs.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
                      className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                    />
                    <button type="button" onClick={() => setOrderCapRows((rs) => rs.filter((_, i) => i !== idx))} className="p-2 rounded-xl border border-surface-border text-white/60 hover:text-red-300 hover:border-red-500/40 justify-self-end sm:justify-self-center" title="Remove row">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setOrderCapRows((rs) => [...rs, { symbol: '', value: '' }])} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-surface-border text-xs font-bold text-white/80 hover:border-gold/40">
                  <Plus size={12} /> Add row
                </button>
              </div>
            </div>
          </div>

          <div>
            <h3 className="text-sm font-extrabold text-white/90 uppercase tracking-wide mb-3">Per-pair open exposure caps (USDT)</h3>
            <div className="rounded-xl border border-surface-border/90 overflow-hidden bg-surface-dark/30">
              <div className="hidden sm:grid sm:grid-cols-[1fr_8rem_2.75rem] gap-2 px-3 py-2 bg-white/[0.06] text-xs font-bold text-white/60 uppercase tracking-wide border-b border-surface-border/80">
                <span>Pair</span>
                <span className="text-right pr-1">Max open</span>
                <span className="sr-only">Remove</span>
              </div>
              <div className="p-3 space-y-2">
                {openCapRows.length === 0 && <p className="text-white/50 text-sm">No per-pair open exposure caps.</p>}
                {openCapRows.map((row, idx) => (
                  <div key={idx} className="grid sm:grid-cols-[1fr_8rem_2.75rem] gap-2 items-center">
                    <input
                      placeholder="e.g. BTCUSDT"
                      value={row.symbol}
                      onChange={(e) => setOpenCapRows((rs) => rs.map((r, i) => (i === idx ? { ...r, symbol: e.target.value.toUpperCase() } : r)))}
                      className="min-w-0 rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white font-mono"
                    />
                    <input
                      type="number"
                      step="0.0001"
                      min="0"
                      placeholder="USDT"
                      value={row.value}
                      onChange={(e) => setOpenCapRows((rs) => rs.map((r, i) => (i === idx ? { ...r, value: e.target.value } : r)))}
                      className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
                    />
                    <button type="button" onClick={() => setOpenCapRows((rs) => rs.filter((_, i) => i !== idx))} className="p-2 rounded-xl border border-surface-border text-white/60 hover:text-red-300 hover:border-red-500/40 justify-self-end sm:justify-self-center" title="Remove row">
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
                <button type="button" onClick={() => setOpenCapRows((rs) => [...rs, { symbol: '', value: '' }])} className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl border border-surface-border text-xs font-bold text-white/80 hover:border-gold/40">
                  <Plus size={12} /> Add row
                </button>
              </div>
            </div>
          </div>
        </div>

        <p className="text-sm text-white/55 mt-6">
          Save these values with <span className="font-semibold text-white/80">Save fees and limits</span> above. Live balances:{' '}
          <Link to="/treasury" className="text-gold-light font-semibold hover:underline">Treasury</Link>.
        </p>
      </AdminPanel>
      ) : null}

      {activeTab === 'limits' ? (
      <AdminPanel
        title="Sensitive endpoint rate limits"
        subtitle="Throttle authentication, signup, 2FA, and withdrawal endpoints. Set a limit to 0 to disable that bucket only."
      >
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[
            ['rate_limit_login_per_ip_per_min', 'Logins per IP (per minute)'],
            ['rate_limit_login_per_email_per_hr', 'Logins per email (per hour)'],
            ['rate_limit_register_per_ip_per_min', 'Signups per IP (per minute)'],
            ['rate_limit_2fa_per_uid_per_min', '2FA actions per user (per minute)'],
            ['rate_limit_withdraw_per_uid_per_min', 'Withdrawals per user (per minute)'],
            ['rate_limit_withdraw_per_uid_per_day', 'Withdrawals per user (per day)'],
          ].map(([key, title]) => (
            <label key={key} className="block">
              <span className="block text-sm font-semibold text-white mb-2">{title}</span>
              <input
                type="number"
                step="1"
                min="0"
                value={limits[key]}
                onChange={(e) => setLimits((v) => ({ ...v, [key]: e.target.value }))}
                className="w-full rounded-xl bg-surface-dark border border-surface-border px-3 py-2 text-sm text-white"
              />
            </label>
          ))}
        </div>
        <p className="text-xs text-white/55 mt-4">
          Turn off all buckets with the <span className="font-semibold text-white/80">Rate limiting</span> feature switch in Feature switches.
        </p>
      </AdminPanel>
      ) : null}

      {activeTab === 'deposit_monitor' ? (
        <DepositMonitorSection
          controls={controls}
          patchControls={patchControls}
          busy={busy}
        />
      ) : null}

      {activeTab === 'referral' ? (
        <ReferralSection
          controls={controls}
          patchControls={patchControls}
          busy={busy}
        />
      ) : null}

      {activeTab === 'hedging' ? (
        <HedgerGlobalsSection
          controls={controls}
          patchControls={patchControls}
          busy={busy}
        />
      ) : null}

      {activeTab === 'binance_liquidity' ? (
        <div className="space-y-4">
          <BinanceLiquiditySection
            controls={controls}
            patchControls={patchControls}
            busy={busy}
          />
          <BinanceLiquidityGuardrailsSection
            controls={controls}
            patchControls={patchControls}
            busy={busy}
          />
        </div>
      ) : null}

      {activeTab === 'alerts' ? (
        <AlertWebhookSection
          controls={controls}
          patchControls={patchControls}
          busy={busy}
        />
      ) : null}

      <ConfirmModal
        open={confirm.open}
        title={confirm.type === 'limits' ? 'Save fees and limits' : 'Confirm feature change'}
        message={
          confirm.type === 'limits'
            ? 'Apply these fee, withdrawal, treasury, and rate-limit values to the platform for new activity.'
            : confirm.key === 'sms_dev_otp_enabled'
              ? `${confirm.enabled ? 'Enable dev OTP mode' : 'Disable dev OTP mode'}? ${confirm.enabled ? 'AuthKey SMS will be skipped and the fixed code will be used for all phone verification.' : 'Real SMS will be sent via AuthKey when credentials are configured.'}`
              : (confirm.key === 'email_otp_service_enabled' && !confirm.enabled)
              ? 'Turn OFF Email OTP? New registrations will skip email verification — email is accepted without a code. Users can verify from their profile later.'
              : (confirm.key === 'email_otp_service_enabled' && confirm.enabled)
              ? 'Turn ON Email OTP? New registrations will require users to verify their email with a one-time code before completing signup.'
              : (confirm.key === 'sms_otp_service_enabled' && !confirm.enabled)
              ? 'Turn OFF SMS OTP? The phone number step will be hidden during signup — no SMS is sent. Users can add and verify their mobile from their profile later.'
              : (confirm.key === 'sms_otp_service_enabled' && confirm.enabled)
              ? 'Turn ON SMS OTP? New registrations will require users to enter and verify their phone number via SMS before completing signup.'
              : `${confirm.enabled ? 'Turn on' : 'Turn off'} "${platformFeatureMeta(confirm.key).title}"?`
        }
        confirmText={confirm.type === 'limits' ? 'Save' : 'Apply'}
        danger={confirm.type === 'toggle' && (
          (confirm.key === 'maintenance_mode' || confirm.key === 'coming_soon_enabled' || confirm.key === 'sms_dev_otp_enabled')
            ? confirm.enabled
            : !confirm.enabled
        )}
        busy={busy}
        onClose={() => { if (!busy) setConfirm({ open: false, type: '', key: '', enabled: false }); }}
        onConfirm={async () => {
          const c = confirm;
          setConfirm({ open: false, type: '', key: '', enabled: false });
          if (c.type === 'limits') await saveLimits();
          if (c.type === 'toggle' && c.key) await patchControls({ [c.key]: c.enabled });
        }}
      />

    </div>
  );
}
