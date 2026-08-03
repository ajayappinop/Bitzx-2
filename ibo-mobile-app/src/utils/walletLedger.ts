/**
 * Spot wallet ledger — aligned with backend `wallet_txns` / `GET /api/wallet/transactions`
 * (see `backend/server.py` `_USER_LEDGER_TYPES` and `wallet_service.TxnType`).
 */
import type { LedgerDirection, LedgerTxnType, TransactionType, WalletTransaction } from '../types/wallet.types';

/** Filter values accepted by the API `type` query param. */
export const LEDGER_API_TYPES: LedgerTxnType[] = [
  'deposit',
  'withdraw',
  'trade',
  'fee',
  'adjustment',
  'lock',
  'unlock',
  'seed',
  'opening_balance',
];

const LEDGER_TYPE_SET = new Set<string>(LEDGER_API_TYPES);

/** Map legacy / alternate names to API ledger types. */
const LEGACY_TYPE_MAP: Record<string, LedgerTxnType> = {
  withdrawal: 'withdraw',
  trade_fill: 'trade',
  trade_fee: 'fee',
};

export function canonicalLedgerType(raw: string | undefined): TransactionType {
  const x = (raw ?? '').trim().toLowerCase();
  if (!x) return 'adjustment';
  const mapped = LEGACY_TYPE_MAP[x] ?? x;
  if (LEDGER_TYPE_SET.has(mapped)) return mapped as LedgerTxnType;
  return x as TransactionType;
}

/** User-facing title for a ledger line (never empty / "unknown"). */
export function formatLedgerTypeLabel(type: string | undefined): string {
  const t = String(canonicalLedgerType(type));
  const labels: Record<string, string> = {
    deposit: 'Deposit',
    withdraw: 'Withdrawal',
    trade: 'Trade',
    fee: 'Fee',
    adjustment: 'Adjustment',
    lock: 'Lock',
    unlock: 'Unlock',
    seed: 'Seed',
    opening_balance: 'Opening balance',
    withdrawal: 'Withdrawal',
    trade_fill: 'Trade',
    trade_fee: 'Fee',
    transfer_in: 'Transfer in',
    transfer_out: 'Transfer out',
    bonus: 'Bonus',
  };
  if (labels[t]) return labels[t];
  const s = String(type ?? t).trim();
  if (!s) return 'Ledger';
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function parseDirection(raw: unknown): LedgerDirection | undefined {
  const d = String(raw ?? '').toLowerCase();
  if (d === 'credit' || d === 'debit' || d === 'lock' || d === 'unlock') return d as LedgerDirection;
  return undefined;
}

function parseStatus(raw: unknown): WalletTransaction['status'] {
  const s = String(raw ?? 'completed').toLowerCase();
  const ok = ['pending', 'processing', 'completed', 'failed', 'cancelled'] as const;
  return (ok as readonly string[]).includes(s) ? (s as WalletTransaction['status']) : 'completed';
}

/** Green + vs red − using backend `direction` when present. */
export function isLedgerAmountPositive(item: Pick<WalletTransaction, 'type' | 'direction'>): boolean {
  const { direction } = item;
  if (direction === 'credit' || direction === 'unlock') return true;
  if (direction === 'debit' || direction === 'lock') return false;

  const t = String(canonicalLedgerType(item.type));
  if (t === 'deposit' || t === 'seed' || t === 'opening_balance') return true;
  if (t === 'withdraw' || t === 'fee' || t === 'lock') return false;
  if (t === 'unlock') return true;
  return !['withdraw', 'fee'].includes(t);
}

export function normalizeWalletTransactionsResponse(raw: unknown): WalletTransaction[] {
  const payload = raw as Record<string, unknown> | unknown[] | null | undefined;
  const rows = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as Record<string, unknown>)?.items)
      ? ((payload as Record<string, unknown>).items as unknown[])
      : [];

  return rows.map((row, i) => {
    const r = row as Record<string, unknown>;
    const id = String(r.id ?? r.txn_id ?? '').trim() || `txn_${i}`;
    const typ = canonicalLedgerType(String(r.type ?? ''));
    const direction = parseDirection(r.direction);
    const balAfter = r.balance_after;
    const balBefore = r.balance_before;
    const meta = r.meta && typeof r.meta === 'object' ? (r.meta as Record<string, unknown>) : undefined;

    return {
      txn_id: id,
      asset: String(r.asset ?? '').toUpperCase() || '—',
      type: typ,
      direction,
      amount: r.amount as number | string,
      fee: r.fee as number | string | undefined,
      status: parseStatus(r.status),
      created_at: String(r.created_at ?? ''),
      updated_at: r.updated_at != null ? String(r.updated_at) : undefined,
      tx_hash: r.tx_hash != null ? String(r.tx_hash) : undefined,
      network: r.network != null ? String(r.network) : undefined,
      address: r.address != null ? String(r.address) : undefined,
      note: r.note != null ? String(r.note) : undefined,
      ref_id: r.ref_id != null ? String(r.ref_id) : undefined,
      ref_type: r.ref_type != null ? String(r.ref_type) : undefined,
      balance_after:
        balAfter && typeof balAfter === 'object'
          ? {
              available: Number((balAfter as Record<string, unknown>).available ?? 0),
              locked: Number((balAfter as Record<string, unknown>).locked ?? 0),
            }
          : undefined,
      balance_before:
        balBefore && typeof balBefore === 'object'
          ? {
              available: Number((balBefore as Record<string, unknown>).available ?? 0),
              locked: Number((balBefore as Record<string, unknown>).locked ?? 0),
            }
          : undefined,
      meta,
    };
  });
}

export type WalletTransactionsPage = {
  items: WalletTransaction[];
  total: number;
  skip: number;
  limit: number;
};

export function parseWalletTransactionsPage(raw: unknown, fallbackSkip: number, fallbackLimit: number): WalletTransactionsPage {
  const o = raw as Record<string, unknown> | null | undefined;
  const items = normalizeWalletTransactionsResponse(raw);
  const total = typeof o?.total === 'number' && Number.isFinite(o.total) ? o.total : items.length;
  const skip = typeof o?.skip === 'number' && Number.isFinite(o.skip) ? o.skip : fallbackSkip;
  const limit = typeof o?.limit === 'number' && Number.isFinite(o.limit) ? o.limit : fallbackLimit;
  return { items, total, skip, limit };
}
