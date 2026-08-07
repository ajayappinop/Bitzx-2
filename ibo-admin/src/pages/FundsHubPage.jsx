/**
 * FundsHubPage — Central entry point for the Funds & Treasury section.
 *
 * Shows live pending-item alerts, a plain-English guide to how money
 * flows through the platform, and a card for every sub-section so any
 * admin (new or experienced) immediately understands what each page does
 * and when to use it.
 */
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Layers, ArrowUpCircle, ArrowDownCircle, IndianRupee,
  BookText, ReceiptText, Landmark,
  RefreshCw, AlertCircle, ChevronRight, ArrowRight,
  CheckCircle2, Info, ShieldCheck, Banknote,
  Scale, Flame, ArrowLeftRight,
} from 'lucide-react';
import { api } from '@/lib/api';
import { useAdminAuth } from '@/context/AdminAuthContext';
import { hasPermission, hasAnyPermission } from '@/lib/adminAccess';
import { AdminPageHeader } from '@/components/AdminPrimitives';

/* ── tiny helpers ─────────────────────────────────────────────────────── */

function fmtNum(n, dp = 4) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '0';
  return v.toLocaleString(undefined, { maximumFractionDigits: dp, minimumFractionDigits: 0 });
}

/* ── Section catalogue ────────────────────────────────────────────────── */

const SECTIONS = [
  {
    id: 'withdrawals',
    to: '/withdrawals',
    icon: ArrowUpCircle,
    color: 'amber',
    label: 'Withdrawals',
    role: 'Operations · Daily',
    what: 'User withdrawal requests waiting for approval or broadcast. Amounts above the auto-approve threshold land here for manual review.',
    when: 'Check daily. Every item here means a user is waiting for their crypto payout.',
    action: 'Review withdrawals',
    permission: 'view_withdrawals',
    alertKey: 'withdrawals',
  },
  {
    id: 'deposit-events',
    to: '/deposit-events',
    icon: ArrowDownCircle,
    color: 'emerald',
    label: 'Deposit Events',
    role: 'Operations · On-demand',
    what: 'On-chain deposits detected by the blockchain poller for every user HD address. Each event = crypto arrived at a user\'s deposit wallet.',
    when: 'When a user reports their deposit hasn\'t credited. Find the event, check status, and manually credit if needed.',
    action: 'View deposit events',
    permission: 'view_withdrawals',
    alertKey: 'deposits',
  },
  {
    id: 'inr-deposits',
    to: '/inr-deposits',
    icon: IndianRupee,
    color: 'orange',
    label: 'INR Deposits',
    role: 'Finance · Multiple times daily',
    what: 'Indian Rupee bank transfer (UPI / NEFT / IMPS) deposit proofs submitted by users. Approve to credit their INR balance.',
    when: 'Process throughout the day. Pending = user uploaded a payment proof and is waiting for INR to appear in their wallet.',
    action: 'Review INR deposits',
    permission: 'view_withdrawals',
    alertKey: 'inrDeposits',
  },
  {
    id: 'inr-withdrawals',
    to: '/inr-withdrawals',
    icon: Banknote,
    color: 'rose',
    label: 'INR Withdrawals',
    role: 'Finance · Multiple times daily',
    what: 'INR bank withdrawal requests. Verify the bank details and confirm to initiate a bank transfer to the user\'s account.',
    when: 'Process throughout the day. Each pending item = user wants to withdraw INR back to their bank.',
    action: 'Review INR withdrawals',
    permission: 'view_withdrawals',
    alertKey: 'inrWithdrawals',
  },
  {
    id: 'ledger',
    to: '/ledger',
    icon: BookText,
    color: 'violet',
    label: 'Ledger',
    role: 'Audit · On-demand',
    what: 'Read-only, append-only record of every single wallet transaction on the platform — deposits, withdrawals, trades, fees, adjustments. Never changes, never deletes.',
    when: 'When investigating a user\'s balance discrepancy, auditing platform finances, or exporting data for compliance.',
    action: 'Open ledger',
    permission: 'view_ledger',
  },
  {
    id: 'wallet-adjustments',
    to: '/wallet-adjustments',
    icon: Scale,
    color: 'cyan',
    label: 'Wallet Management',
    role: 'Operations · On-demand',
    what: 'Manually credit or debit any user\'s funding or futures wallet. Every adjustment requires a reason note and is permanently logged for audit.',
    when: 'Compensating a user for a platform error, correcting a misposted balance, or provisioning a test account.',
    action: 'Manage wallets',
    permissions: ['manage_users', 'adjust_wallets'],
  },
  {
    id: 'finance',
    to: '/finance',
    icon: ReceiptText,
    color: 'emerald',
    label: 'Finance & Reports',
    role: 'Finance · Weekly/Monthly',
    what: 'Platform-level revenue, fee income, P&L, and trading volume breakdowns. Filter by date range and export to CSV or Excel.',
    when: 'Monthly reporting, investor updates, reconciliation, or tax preparation.',
    action: 'Open reports',
    permission: 'view_finance',
  },
  {
    id: 'treasury',
    to: '/treasury',
    icon: Landmark,
    color: 'gold',
    label: 'Treasury',
    role: 'Treasury · Daily',
    what: 'Custody overview: compares the ledger\'s expected on-chain balance with what is actually in the hot wallet. Flags gaps that need deposit sweeps.',
    when: 'Daily reconciliation check. A "sync gap" here means user funds are still on HD addresses and haven\'t been swept to the hot wallet yet.',
    action: 'Open treasury',
    permission: 'view_treasury',
  },
  {
    id: 'admin-wallet',
    to: '/admin-wallet',
    icon: Flame,
    color: 'violet',
    label: 'Admin Wallet',
    role: 'Treasury · Before payouts',
    what: 'Live on-chain balances of the withdrawal hot wallet (funded by deposit sweeps). Also shows the chain rails — which treasury address handles each network.',
    when: 'Before approving large withdrawals — confirm the hot wallet has enough funds. Also use this to check if an address needs to be updated.',
    action: 'Check hot wallet',
    permission: 'view_treasury',
  },
  {
    id: 'treasury-transfer',
    to: '/treasury-transfer',
    icon: ArrowLeftRight,
    color: 'gold',
    label: 'Treasury Transfer',
    role: 'Treasury · On-demand',
    what: 'Record and track manual sends from treasury wallets to any external address. Paste a tx hash after broadcasting to trigger automatic RPC verification.',
    when: 'Sending treasury funds to cold storage, a partner exchange, or a liquidity pool. Always record here for the audit trail.',
    action: 'Start transfer',
    permission: 'view_treasury',
  },
  {
    id: 'treasury-omnibus',
    to: '/treasury-omnibus',
    icon: ShieldCheck,
    color: 'rose',
    label: 'Hot & Cold Wallets',
    role: 'Treasury · On-demand',
    what: 'The omnibus wallet registry — add or edit hot/cold treasury addresses. Also run deposit sweeps to consolidate user HD-address funds into the hot wallet.',
    when: 'When the hot wallet is running low on a specific asset — run a sweep to pull in user HD-address balances. Or when updating treasury signing keys.',
    action: 'Manage omnibus',
    permission: 'view_treasury',
  },
];

/* ── colour map ───────────────────────────────────────────────────────── */

const COLORS = {
  amber:   {
    ring: 'border-[#FE6C02]/35',
    bg: 'bg-[#FE6C02]/12',
    icon: 'text-[#FE6C02]',
    badge: 'bg-[#FE6C02]/15 text-[#8f3600] border border-[#FE6C02]/30',
    btn: 'border-[#FE6C02]/35 text-[#8f3600] hover:bg-[#FE6C02]/10',
  },
  emerald: {
    ring: 'border-[#00A876]/35',
    bg: 'bg-[#00A876]/12',
    icon: 'text-[#00A876]',
    badge: 'bg-[#00A876]/15 text-[#007a56] border border-[#00A876]/30',
    btn: 'border-[#00A876]/35 text-[#007a56] hover:bg-[#00A876]/10',
  },
  orange:  {
    ring: 'border-[#FE6C02]/35',
    bg: 'bg-[#FE6C02]/12',
    icon: 'text-[#E76202]',
    badge: 'bg-[#FE6C02]/15 text-[#8f3600] border border-[#FE6C02]/30',
    btn: 'border-[#FE6C02]/35 text-[#8f3600] hover:bg-[#FE6C02]/10',
  },
  rose:    {
    ring: 'border-[#EB5454]/35',
    bg: 'bg-[#EB5454]/12',
    icon: 'text-[#EB5454]',
    badge: 'bg-[#EB5454]/15 text-[#c53030] border border-[#EB5454]/30',
    btn: 'border-[#EB5454]/35 text-[#c53030] hover:bg-[#EB5454]/10',
  },
  violet:  {
    ring: 'border-[#B44D01]/35',
    bg: 'bg-[#B44D01]/12',
    icon: 'text-[#B44D01]',
    badge: 'bg-[#FE6C02]/12 text-[#8f3600] border border-[#B44D01]/30',
    btn: 'border-[#B44D01]/35 text-[#8f3600] hover:bg-[#FE6C02]/10',
  },
  cyan:    {
    ring: 'border-[#FE6C02]/35',
    bg: 'bg-[#FE6C02]/10',
    icon: 'text-[#FE6C02]',
    badge: 'bg-[#FE6C02]/15 text-[#8f3600] border border-[#FE6C02]/30',
    btn: 'border-[#FE6C02]/35 text-[#8f3600] hover:bg-[#FE6C02]/10',
  },
  gold:    {
    ring: 'border-[#FE6C02]/35',
    bg: 'bg-[#FE6C02]/12',
    icon: 'text-[#FE6C02]',
    badge: 'bg-[#FE6C02]/15 text-[#8f3600] border border-[#FE6C02]/30',
    btn: 'border-[#FE6C02]/35 text-[#8f3600] hover:bg-[#FE6C02]/10',
  },
};

/* ── SectionCard ──────────────────────────────────────────────────────── */

function SectionCard({ section, alerts }) {
  const c = COLORS[section.color] || COLORS.cyan;
  const pendingCount = alerts?.[section.alertKey] || 0;
  const Icon = section.icon;

  return (
    <Link
      to={section.to}
      className={`group flex flex-col gap-3 rounded-lg border ${c.ring} bg-surface-card p-5 transition-all hover:shadow-md hover:border-[#FE6C02]/45`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className={`w-11 h-11 rounded-lg ${c.bg} border ${c.ring} flex items-center justify-center shrink-0`}>
          <Icon size={22} strokeWidth={2.15} className={c.icon} aria-hidden />
        </div>
        {pendingCount > 0 && (
          <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold ${c.badge}`}>
            <AlertCircle size={11} strokeWidth={2.2} />
            {pendingCount > 99 ? '99+' : pendingCount} pending
          </span>
        )}
      </div>

      {/* Title + role */}
      <div>
        <p className="text-base font-bold text-[color:var(--ibo-ink)]">{section.label}</p>
        <p className={`text-[11px] font-semibold uppercase tracking-wide mt-0.5 ${c.icon}`}>
          {section.role}
        </p>
      </div>

      {/* What it does */}
      <p className="text-sm text-white/65 leading-relaxed flex-1">{section.what}</p>

      {/* When to use */}
      <div className="rounded-md bg-[color:var(--ibo-bg)] border border-surface-border px-3 py-2">
        <p className="text-[11px] font-semibold text-white/40 uppercase tracking-wide mb-0.5">When to use</p>
        <p className="text-xs text-white/60 leading-relaxed">{section.when}</p>
      </div>

      {/* CTA */}
      <div className={`mt-auto flex items-center justify-between rounded-md border ${c.btn} px-3 py-2 text-xs font-semibold transition-colors`}>
        {section.action}
        <ChevronRight size={14} strokeWidth={2.2} className="group-hover:translate-x-0.5 transition-transform" />
      </div>
    </Link>
  );
}

/* ── Funds flow diagram ───────────────────────────────────────────────── */

function FlowStep({ n, label, desc, color = 'cyan', last = false }) {
  const dotCls = {
    emerald: 'bg-[#00A876] ring-[#00A876]/30',
    amber:   'bg-[#FE6C02] ring-[#FE6C02]/30',
    violet:  'bg-[#B44D01] ring-[#FE6C02]/30',
    cyan:    'bg-[#FE6C02] ring-[#FE6C02]/30',
    gold:    'bg-[#FE6C02] ring-[#FE6C02]/30',
    rose:    'bg-[#EB5454] ring-[#EB5454]/30',
  }[color] || 'bg-[#FE6C02] ring-[#FE6C02]/30';

  return (
    <div className="flex gap-3 min-w-0">
      <div className="flex flex-col items-center shrink-0">
        <div className={`w-7 h-7 rounded-full ring-4 ${dotCls} flex items-center justify-center text-xs font-extrabold text-white z-10`}>
          {n}
        </div>
        {!last && <div className="w-px flex-1 bg-white/10 my-1" />}
      </div>
      <div className="pb-5 min-w-0">
        <p className="text-sm font-bold text-white">{label}</p>
        <p className="text-xs text-white/55 leading-relaxed mt-0.5">{desc}</p>
      </div>
    </div>
  );
}

function FundsFlowGuide() {
  const [tab, setTab] = useState('deposit');
  const tabs = [
    { id: 'deposit',    label: 'Crypto Deposit' },
    { id: 'withdrawal', label: 'Crypto Withdrawal' },
    { id: 'inr',        label: 'INR (Fiat)' },
    { id: 'treasury',   label: 'Treasury Ops' },
  ];

  const flows = {
    deposit: [
      { n: 1, color: 'cyan',    label: 'User sends crypto',        desc: 'User copies their unique deposit address (HD wallet) and sends from an external wallet or exchange.' },
      { n: 2, color: 'emerald', label: 'Blockchain poller detects it', desc: 'The deposit poller scans the chain every few seconds. A Deposit Event is created with status "confirming".' },
      { n: 3, color: 'amber',   label: 'Confirmations reached',    desc: 'After the required number of block confirmations, the crediter process runs automatically.' },
      { n: 4, color: 'violet',  label: 'Ledger credited',          desc: 'A wallet transaction is appended to the Ledger. The user\'s available balance increases instantly.' },
      { n: 5, color: 'gold',    label: 'Funds on HD address → Sweep needed', desc: 'The crypto still sits on the user\'s HD address. A deposit sweep is required to move it to the hot wallet before it can fund withdrawals.', last: true },
    ],
    withdrawal: [
      { n: 1, color: 'amber',   label: 'User requests withdrawal',  desc: 'User fills in the external address and amount. Funds are locked in their wallet immediately.' },
      { n: 2, color: 'rose',    label: 'Approval queue',           desc: 'Amounts above the auto-approve threshold land in the Withdrawals page with status "pending_approval". Admin must review.' },
      { n: 3, color: 'cyan',    label: 'Admin approves',           desc: 'Approving unlocks the funds and queues the on-chain transaction. The withdrawal executor broadcasts it.' },
      { n: 4, color: 'emerald', label: 'Broadcasted & confirmed',  desc: 'Once the tx is mined the withdrawal status becomes "confirmed". The user\'s locked balance is debited.' },
      { n: 5, color: 'gold',    label: 'Hot wallet balance decreases', desc: 'Check Admin Wallet regularly — if the hot wallet runs low, run a deposit sweep or Treasury Transfer to top it up.', last: true },
    ],
    inr: [
      { n: 1, color: 'amber',   label: 'User initiates INR deposit', desc: 'User transfers money via UPI/NEFT/IMPS to the platform\'s bank account, then uploads a payment proof.' },
      { n: 2, color: 'cyan',    label: 'INR Deposits queue',        desc: 'The proof appears in INR Deposits with status "pending". Admin reviews the screenshot against the bank statement.' },
      { n: 3, color: 'emerald', label: 'Admin approves',            desc: 'Approving credits the user\'s INR balance. Rejecting sends a rejection reason back to the user.' },
      { n: 4, color: 'violet',  label: 'INR Withdrawals (reverse)', desc: 'When the user withdraws INR, the request appears in INR Withdrawals. Admin approves and initiates the bank transfer manually.', last: true },
    ],
    treasury: [
      { n: 1, color: 'cyan',    label: 'User deposits arrive on HD addresses', desc: 'Every user has a unique HD-derived deposit address. Funds land there, not directly in the hot wallet.' },
      { n: 2, color: 'amber',   label: 'Custody gap detected',     desc: 'Treasury page compares the ledger\'s expected balance vs hot wallet. A gap means HD addresses hold unswept funds.' },
      { n: 3, color: 'emerald', label: 'Deposit sweep',            desc: 'Hot & Cold Wallets → run a sweep. The platform moves funds from all HD addresses into the hot wallet.' },
      { n: 4, color: 'violet',  label: 'Hot wallet funded',        desc: 'Admin Wallet now shows the correct balance. Withdrawals can be processed without "awaiting treasury" blocks.' },
      { n: 5, color: 'gold',    label: 'Periodic cold storage transfer', desc: 'Treasury Transfer → manually move excess hot wallet funds to cold storage for security. Always log the tx hash.', last: true },
    ],
  };

  return (
    <div className="admin-section">
      <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 border-b border-surface-border/70">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h2 className="admin-section-title !mb-1 flex items-center gap-2">
              <Info size={18} strokeWidth={2.15} className="text-[#FE6C02]" />
              How Funds Flow — Plain English Guide
            </h2>
            <p className="text-sm text-white/60">Step-by-step: what happens behind the scenes for each money movement type.</p>
          </div>
        </div>
        {/* Tabs */}
        <div className="flex flex-wrap gap-2 mt-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${
                tab === t.id
                  ? 'bg-gold/20 border-gold/40 text-gold-light'
                  : 'bg-transparent border-surface-border text-white/55 hover:border-white/30 hover:text-white/80'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      <div className="p-4 sm:p-5">
        <div className="max-w-xl">
          {(flows[tab] || []).map((step) => (
            <FlowStep key={step.n} {...step} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ── Alert banner ─────────────────────────────────────────────────────── */

function PendingAlertBanner({ alerts, loading }) {
  if (loading) return null;
  const total = Object.values(alerts).reduce((s, v) => s + v, 0);
  if (total === 0) return (
    <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 flex items-center gap-2.5 text-sm text-emerald-200">
      <CheckCircle2 size={16} className="shrink-0 text-emerald-400" />
      <span>All clear — no pending items require your attention right now.</span>
    </div>
  );

  const items = [
    alerts.withdrawals    && { label: `${alerts.withdrawals} withdrawal${alerts.withdrawals > 1 ? 's' : ''} pending approval`,    to: '/withdrawals',      color: 'text-gold-light' },
    alerts.deposits       && { label: `${alerts.deposits} deposit event${alerts.deposits > 1 ? 's' : ''} need attention`,         to: '/deposit-events',   color: 'text-emerald-300' },
    alerts.inrDeposits    && { label: `${alerts.inrDeposits} INR deposit${alerts.inrDeposits > 1 ? 's' : ''} awaiting review`,   to: '/inr-deposits',     color: 'text-orange-300' },
    alerts.inrWithdrawals && { label: `${alerts.inrWithdrawals} INR withdrawal${alerts.inrWithdrawals > 1 ? 's' : ''} to process`, to: '/inr-withdrawals',  color: 'text-rose-300' },
  ].filter(Boolean);

  return (
    <div className="rounded-xl border border-gold/30 bg-gold/10 px-4 py-3.5 space-y-2">
      <div className="flex items-center gap-2 text-gold-light font-semibold text-sm">
        <AlertCircle size={16} className="text-gold shrink-0" />
        {total} item{total > 1 ? 's' : ''} need{total === 1 ? 's' : ''} your attention
      </div>
      <ul className="space-y-1.5 pl-6">
        {items.map((item) => (
          <li key={item.to}>
            <Link
              to={item.to}
              className={`text-sm ${item.color} hover:underline inline-flex items-center gap-1`}
            >
              {item.label} <ArrowRight size={12} />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Quick reference table ────────────────────────────────────────────── */

function QuickRef() {
  const rows = [
    { q: 'A user says their deposit hasn\'t arrived',        where: 'Deposit Events',       to: '/deposit-events',   icon: ArrowDownCircle, color: 'text-[#00A876]' },
    { q: 'User is waiting for a crypto withdrawal',         where: 'Withdrawals',          to: '/withdrawals',      icon: ArrowUpCircle,   color: 'text-[#FE6C02]' },
    { q: 'User uploaded INR payment proof',                 where: 'INR Deposits',         to: '/inr-deposits',     icon: IndianRupee,     color: 'text-[#E76202]' },
    { q: 'User wants INR back to their bank',               where: 'INR Withdrawals',      to: '/inr-withdrawals',  icon: Banknote,        color: 'text-[#EB5454]' },
    { q: 'Need to credit/debit a user\'s balance manually', where: 'Wallet Management',    to: '/wallet-adjustments',icon: Scale,          color: 'text-[#FE6C02]' },
    { q: 'Check hot wallet balance before big payout',      where: 'Admin Wallet',         to: '/admin-wallet',     icon: Flame,           color: 'text-[#B44D01]' },
    { q: 'Hot wallet running low — need to refill it',       where: 'Hot & Cold Wallets (run sweep)', to: '/treasury-omnibus', icon: ShieldCheck, color: 'text-[#EB5454]' },
    { q: 'Send treasury funds to cold storage',             where: 'Treasury Transfer',    to: '/treasury-transfer',icon: ArrowLeftRight,  color: 'text-[#FE6C02]' },
    { q: 'Monthly revenue & fee report',                    where: 'Finance & Reports',    to: '/finance',          icon: ReceiptText,     color: 'text-[#00A876]' },
    { q: 'Audit a user\'s balance history',                 where: 'Ledger',               to: '/ledger',           icon: BookText,        color: 'text-[#B44D01]' },
  ];

  return (
    <div className="admin-section">
      <div className="px-4 sm:px-5 pt-4 sm:pt-5 pb-3 border-b border-surface-border/70">
        <h2 className="admin-section-title !mb-1">Quick Reference — What do I open?</h2>
        <p className="text-sm text-white/60">Find the right page for any common task in seconds.</p>
      </div>
      <div className="divide-y divide-surface-border/40">
        {rows.map((row) => {
          const Icon = row.icon;
          return (
            <Link
              key={row.to}
              to={row.to}
              className="flex items-center justify-between gap-4 px-4 sm:px-5 py-3.5 hover:bg-surface-hover transition-colors group"
            >
              <div className="flex items-center gap-3 min-w-0">
                <span className="w-8 h-8 rounded-md border border-surface-border bg-[color:var(--ibo-bg)] flex items-center justify-center shrink-0">
                  <Icon size={16} strokeWidth={2.15} className={row.color} aria-hidden />
                </span>
                <p className="text-sm text-white/75 group-hover:text-[color:var(--ibo-ink)] transition-colors truncate">
                  {row.q}
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`text-xs font-semibold ${row.color}`}>{row.where}</span>
                <ChevronRight size={13} strokeWidth={2.2} className="text-white/30 group-hover:translate-x-0.5 transition-transform" />
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

/* ── Main page ────────────────────────────────────────────────────────── */

export default function FundsHubPage() {
  const { admin } = useAdminAuth();
  const navigate = useNavigate();

  const [alerts, setAlerts] = useState({ withdrawals: 0, deposits: 0, inrDeposits: 0, inrWithdrawals: 0 });
  const [alertsLoading, setAlertsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const loadAlerts = useCallback(async () => {
    setRefreshing(true);
    try {
      const [wdRes, depRes, inrRes] = await Promise.allSettled([
        api.withdrawals({ status: 'pending_approval', limit: '1' }),
        api.depositEvents({ status: 'pending', limit: '1' }),
        api.inrStats(),
      ]);

      const wd  = wdRes.status  === 'fulfilled' ? await wdRes.value.json().catch(() => ({}))  : {};
      const dep = depRes.status === 'fulfilled' ? await depRes.value.json().catch(() => ({})) : {};
      const inr = inrRes.status === 'fulfilled' ? await inrRes.value.json().catch(() => ({})) : {};

      setAlerts({
        withdrawals:    Number(wd.total  ?? wd.count  ?? 0),
        deposits:       Number(dep.total ?? dep.count ?? 0),
        inrDeposits:    Number(inr.pending_deposit_count    ?? inr.pending_count ?? 0),
        inrWithdrawals: Number(inr.pending_withdrawal_count ?? 0),
      });
    } catch { /* ignore — best-effort */ }
    finally {
      setAlertsLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadAlerts(); }, [loadAlerts]);

  // Filter section cards to only show what this admin can see
  const visibleSections = SECTIONS.filter((s) => {
    if (s.permissions) return hasAnyPermission(admin, s.permissions);
    return hasPermission(admin, s.permission);
  });

  return (
    <div className="space-y-6 pb-10">
      {/* Page header */}
      <AdminPageHeader
        icon={Layers}
        iconClassName="text-gold"
        title="Funds & Treasury"
        subtitle="Everything money-related in one place — deposits, withdrawals, INR, wallet adjustments, treasury balances, and reporting. Start here if you're not sure where to go."
        actionsWithBadge
        actions={(
          <button
            type="button"
            onClick={loadAlerts}
            disabled={refreshing}
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-xl border border-surface-border text-sm text-white/80 hover:border-gold/40 transition-colors disabled:opacity-50"
          >
            <RefreshCw size={14} className={refreshing ? 'animate-spin' : ''} />
            Refresh alerts
          </button>
        )}
      />

      {/* Pending alerts banner */}
      <PendingAlertBanner alerts={alerts} loading={alertsLoading} />

      {/* Section cards */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-base font-bold text-white/80">All Fund Sections</h2>
          <span className="text-xs text-white/35">{visibleSections.length} sections visible to your role</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visibleSections.map((s) => (
            <SectionCard key={s.id} section={s} alerts={alerts} />
          ))}
        </div>
      </div>

      {/* Quick reference */}
      <QuickRef />

      {/* How it works flow guide */}
      <FundsFlowGuide />

      {/* Warning reminder */}
      <div className="rounded-xl border border-gold/25 bg-gold/5 px-4 py-3.5 flex gap-3">
        <AlertCircle size={18} className="text-gold shrink-0 mt-0.5" />
        <div className="space-y-1 text-sm text-gold-light/80 leading-relaxed">
          <p className="font-semibold text-gold-light">Important reminders for all fund operations</p>
          <ul className="space-y-1 text-gold-light/70 list-disc pl-4 text-xs">
            <li><strong>Every adjustment</strong> in Wallet Management is permanent and audit-logged. Always add a clear note.</li>
            <li><strong>Before large payouts</strong>, check Admin Wallet first — confirm the hot wallet has sufficient funds.</li>
            <li><strong>Deposit sweeps</strong> consolidate user HD-address funds into the hot wallet. Run sweeps in dry-run first.</li>
            <li><strong>Treasury Transfers</strong> are manual — always record the on-chain tx hash for the audit trail.</li>
            <li><strong>The Ledger</strong> is append-only and never deletes. Use it as the source of truth for any balance dispute.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
