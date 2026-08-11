/** INR deposit / withdrawal / ledger display helpers for admin UI. */

export const INR_STATUS_LABELS = {
  pending: 'Pending review',
  approving: 'Processing',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function isUserCancelledInrWithdrawal(record) {
  if (!record || String(record.status || '').toLowerCase() !== 'rejected') return false;
  const reason = String(
    record.rejection_reason
    || record?.meta?.rejection_reason
    || '',
  ).trim().toLowerCase();
  return reason === 'cancelled by user';
}

export function inrStatusLabel(status, opts = {}) {
  if (
    String(status || '').toLowerCase() === 'rejected'
    && String(opts.rejectionReason || '').trim().toLowerCase() === 'cancelled by user'
  ) {
    return INR_STATUS_LABELS.cancelled;
  }
  const key = String(status || 'pending').toLowerCase();
  return INR_STATUS_LABELS[key] || key.replace(/_/g, ' ');
}

export function formatInrAmount(amountInr) {
  const n = Number(amountInr);
  if (!Number.isFinite(n)) return '—';
  return `₹${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function getInrRefDisplay(row) {
  if (!row) return { utr: null, depositId: null };
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const utr = String(meta.utr_number || row.utr_number || '').trim() || null;
  const depositId = row.ref_id ? String(row.ref_id) : null;
  return { utr, depositId };
}

export function getInrWithdrawalRefDisplay(row) {
  if (!row) return { utr: null, withdrawalId: null };
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const utr = String(meta.payout_reference || row.payout_reference || '').trim() || null;
  const withdrawalId = row.ref_id ? String(row.ref_id) : null;
  return { utr, withdrawalId };
}

export function isInrWithdrawalRow(row) {
  return row?.ref_type === 'inr_withdrawal'
    || row?._ledgerKind === 'inr_withdrawal_request'
    || row?._ledgerKind === 'inr_withdrawal_outcome'
    || row?.type === 'inr_withdrawal';
}

export function formatInrDepositRef(row) {
  const { utr, depositId } = getInrRefDisplay(row);
  if (utr) return utr;
  if (depositId) return depositId.length > 14 ? `${depositId.slice(0, 12)}…` : depositId;
  return '—';
}

export function formatInrActivityDetail(dep) {
  if (!dep) return '—';
  const parts = [inrStatusLabel(dep.status)];
  if (dep.status === 'approved' && dep.amount_ibo != null) {
    parts.push(`${Number(dep.amount_ibo).toFixed(4)} Delta`);
  }
  return parts.join(' · ');
}

export function formatInrWithdrawalActivityDetail(wd) {
  if (!wd) return '—';
  const parts = [inrStatusLabel(wd.status, { rejectionReason: wd.rejection_reason })];
  if (wd.payout_reference) parts.push(`UTR ${wd.payout_reference}`);
  if (wd.status === 'approved' && wd.amount_ibo != null) {
    parts.push(`${Number(wd.amount_ibo).toFixed(4)} Delta sold`);
  }
  if (wd.status === 'rejected' && wd.rejection_reason) {
    parts.push(wd.rejection_reason);
  }
  return parts.join(' · ');
}

export function formatInrDepositRefTitle(row) {
  if (!row) return '';
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const lines = [];
  if (row.ref_id) lines.push(`Deposit ID: ${row.ref_id}`);
  if (meta.amount_inr != null) lines.push(`Amount: ${formatInrAmount(meta.amount_inr)}`);
  const utr = meta.utr_number || row.utr_number;
  if (utr) lines.push(`UTR: ${utr}`);
  if (meta.amount_ibo != null) lines.push(`Delta credited: ${Number(meta.amount_ibo).toFixed(4)}`);
  if (meta.payment_method_label) lines.push(`Method: ${meta.payment_method_label}`);
  if (row.inr_request_status || row.status) {
    lines.push(`Status: ${inrStatusLabel(row.inr_request_status || row.status)}`);
  }
  return lines.join('\n') || formatInrDepositRef(row);
}

export function formatInrWithdrawalRefTitle(row) {
  if (!row) return '';
  const meta = row.meta && typeof row.meta === 'object' ? row.meta : {};
  const lines = [];
  if (row.ref_id) lines.push(`Request ID: ${row.ref_id}`);
  if (meta.amount_inr != null) lines.push(`INR: ${formatInrAmount(meta.amount_inr)}`);
  const utr = meta.payout_reference || row.payout_reference;
  if (utr) lines.push(`Payout UTR: ${utr}`);
  if (meta.payout_type) lines.push(`Payout: ${meta.payout_type}`);
  const st = row.inr_request_status || row.status;
  if (st) lines.push(`Status: ${inrStatusLabel(st, { rejectionReason: meta.rejection_reason || row.rejection_reason })}`);
  if (meta.rejection_reason) lines.push(`Reason: ${meta.rejection_reason}`);
  return lines.join('\n') || 'INR withdrawal';
}

export function formatWalletTxnRef(row) {
  if (!row) return '—';
  if (row._ledgerKind === 'inr_request' || row.ref_type === 'inr_deposit') {
    return formatInrDepositRef(row);
  }
  if (isInrWithdrawalRow(row)) {
    const { utr } = getInrWithdrawalRefDisplay(row);
    if (utr) return utr;
    if (row.ref_id) return row.ref_id.length > 14 ? `${row.ref_id.slice(0, 12)}…` : row.ref_id;
    return '—';
  }
  return [row.ref_type, row.ref_id].filter(Boolean).join(' · ') || '—';
}

export function ledgerTypeLabel(row) {
  if (row?._ledgerKind === 'inr_request' || row?.type === 'inr_deposit') return 'INR deposit';
  if (row?._ledgerKind === 'inr_withdrawal_request' || row?._ledgerKind === 'inr_withdrawal_outcome') {
    if (isUserCancelledInrWithdrawal(row)) return 'INR sell cancelled';
    return row.status === 'rejected' ? 'INR sell rejected' : 'INR payout';
  }
  if (row?.ref_type === 'inr_deposit' && row?.type === 'deposit') return 'INR deposit';
  if (row?.ref_type === 'inr_withdrawal') {
    const kind = row.meta?.ledger_kind;
    if (kind === 'inr_sell' || row.type === 'lock') return 'INR sell (lock)';
    if (kind === 'inr_payout' || (row.type === 'withdraw' && row.direction === 'debit')) return 'INR payout';
    if (kind === 'inr_sell_cancel' || row.type === 'unlock') return 'INR sell cancel';
    return 'INR withdrawal';
  }
  if (row?.type === 'fee') {
    const phase = String(row?.meta?.phase || '').toLowerCase();
    const feeKind = String(row?.meta?.fee_kind || '').toLowerCase();
    const refType = String(row?.ref_type || '').toLowerCase();
    if (phase.includes('withdrawal') && (phase.includes('gas') || feeKind === 'gas')) {
      return 'Withdrawal gas fee';
    }
    if (phase.includes('withdrawal') || feeKind === 'platform' || refType === 'withdrawal') {
      return 'Withdrawal fee';
    }
  }
  return row?.type || '—';
}

export function ledgerStatusLabel(row) {
  const rejectionReason = row?.rejection_reason || row?.meta?.rejection_reason;
  if (row?.inr_request_status) return inrStatusLabel(row.inr_request_status, { rejectionReason });
  if (row?._ledgerKind === 'inr_request' || row?._ledgerKind === 'inr_withdrawal_request' || row?._ledgerKind === 'inr_withdrawal_outcome') {
    return inrStatusLabel(row.status, { rejectionReason });
  }
  if (row?.ref_type === 'inr_withdrawal' && row.inr_request_status) {
    return inrStatusLabel(row.inr_request_status, { rejectionReason });
  }
  return row?.status || '—';
}

export function inrDepositToLedgerRow(dep) {
  if (!dep?.id) return null;
  return {
    id: `inr-dep-${dep.id}`,
    _ledgerKind: 'inr_request',
    created_at: dep.created_at,
    asset: 'INR',
    type: 'inr_deposit',
    direction: 'request',
    amount: dep.amount_inr,
    balance_after: null,
    ref_type: 'inr_deposit',
    ref_id: dep.id,
    status: dep.status || 'pending',
    inr_request_status: dep.status || 'pending',
    meta: {
      amount_inr: dep.amount_inr,
      utr_number: dep.utr_number,
      amount_ibo: dep.amount_ibo,
      payment_method_label: dep.payment_method_label,
    },
  };
}

export function inrWithdrawalToLedgerRow(wd) {
  if (!wd?.id) return null;
  const status = wd.status || 'pending';
  if (status === 'approved') return null;
  return {
    id: `inr-wd-${wd.id}`,
    _ledgerKind: 'inr_withdrawal_request',
    created_at: wd.created_at,
    asset: 'INR',
    type: 'inr_withdrawal',
    direction: 'request',
    amount: wd.amount_inr,
    balance_after: null,
    ref_type: 'inr_withdrawal',
    ref_id: wd.id,
    status,
    inr_request_status: status,
    payout_reference: wd.payout_reference,
    meta: {
      amount_inr: wd.amount_inr,
      payout_reference: wd.payout_reference,
      payout_type: wd.payout_type,
      rejection_reason: wd.rejection_reason,
    },
  };
}

function inrWithdrawalOutcomeRow(wd) {
  if (!wd?.id) return null;
  const status = String(wd.status || '').toLowerCase();
  if (status !== 'approved' && status !== 'rejected') return null;
  return {
    id: `inr-wd-outcome-${wd.id}`,
    _ledgerKind: 'inr_withdrawal_outcome',
    created_at: wd.reviewed_at || wd.updated_at || wd.created_at,
    asset: 'INR',
    type: 'inr_withdrawal',
    direction: status,
    amount: wd.amount_inr,
    balance_after: null,
    ref_type: 'inr_withdrawal',
    ref_id: wd.id,
    status,
    inr_request_status: status,
    payout_reference: wd.payout_reference,
    meta: {
      amount_inr: wd.amount_inr,
      payout_reference: wd.payout_reference,
      payout_type: wd.payout_type,
      rejection_reason: wd.rejection_reason,
    },
  };
}

function enrichInrDepositLedgerRow(row, inrById) {
  if (!row || !inrById) return row;
  const isDep = row._ledgerKind === 'inr_request' || row.ref_type === 'inr_deposit';
  if (!isDep || !row.ref_id) return row;
  const dep = inrById.get(String(row.ref_id));
  if (!dep) return row;
  const meta = { ...(row.meta && typeof row.meta === 'object' ? row.meta : {}) };
  if (!meta.utr_number && dep.utr_number) meta.utr_number = dep.utr_number;
  if (meta.amount_inr == null && dep.amount_inr != null) meta.amount_inr = dep.amount_inr;
  if (meta.amount_ibo == null && dep.amount_ibo != null) meta.amount_ibo = dep.amount_ibo;
  if (!meta.payment_method_label && dep.payment_method_label) {
    meta.payment_method_label = dep.payment_method_label;
  }
  return {
    ...row,
    meta,
    inr_request_status: dep.status || row.inr_request_status,
  };
}

function enrichInrWithdrawalLedgerRow(row, wdById) {
  if (!row || !wdById || row.ref_type !== 'inr_withdrawal' || !row.ref_id) return row;
  const wd = wdById.get(String(row.ref_id));
  if (!wd) return row;
  const meta = { ...(row.meta && typeof row.meta === 'object' ? row.meta : {}) };
  if (!meta.payout_reference && wd.payout_reference) meta.payout_reference = wd.payout_reference;
  if (meta.amount_inr == null && wd.amount_inr != null) meta.amount_inr = wd.amount_inr;
  if (!meta.payout_type && wd.payout_type) meta.payout_type = wd.payout_type;
  if (!meta.rejection_reason && wd.rejection_reason) meta.rejection_reason = wd.rejection_reason;
  return {
    ...row,
    meta,
    payout_reference: meta.payout_reference || wd.payout_reference,
    inr_request_status: wd.status,
  };
}

export function mergeLedgerWithInrDeposits(walletItems, inrDeposits, inrWithdrawals = []) {
  const wallet = Array.isArray(walletItems) ? walletItems : [];
  const inr = Array.isArray(inrDeposits) ? inrDeposits : [];
  const wds = Array.isArray(inrWithdrawals) ? inrWithdrawals : [];
  const inrById = new Map(inr.filter((d) => d?.id).map((d) => [String(d.id), d]));
  const wdById = new Map(wds.filter((d) => d?.id).map((d) => [String(d.id), d]));

  const creditedDepIds = new Set(
    wallet
      .filter((w) => w.ref_type === 'inr_deposit' && w.ref_id)
      .map((w) => String(w.ref_id)),
  );
  const supplementalDeps = inr
    .filter((d) => d?.id && !creditedDepIds.has(String(d.id)))
    .map(inrDepositToLedgerRow)
    .filter(Boolean);

  const activeWdIds = new Set(
    wallet
      .filter((w) => w.ref_type === 'inr_withdrawal' && w.ref_id)
      .map((w) => String(w.ref_id)),
  );
  const supplementalWds = wds
    .filter((d) => d?.id && !activeWdIds.has(String(d.id)))
    .map(inrWithdrawalToLedgerRow)
    .filter(Boolean);
  const outcomeWds = wds.map(inrWithdrawalOutcomeRow).filter(Boolean);

  const merged = [...supplementalDeps, ...supplementalWds, ...outcomeWds, ...wallet].sort((a, b) =>
    (b.created_at || '').localeCompare(a.created_at || ''),
  );
  return merged.map((row) => {
    let r = enrichInrDepositLedgerRow(row, inrById);
    r = enrichInrWithdrawalLedgerRow(r, wdById);
    return r;
  });
}

export function formatLedgerAmount(row) {
  if (row?._ledgerKind === 'inr_request' || row?._ledgerKind === 'inr_withdrawal_request' || row?._ledgerKind === 'inr_withdrawal_outcome') {
    return formatInrAmount(row.amount);
  }
  if (isInrWithdrawalRow(row) && row.meta?.amount_inr != null) {
    const n = formatInrAmount(row.meta.amount_inr);
    const dir = String(row.direction || '').toLowerCase();
    if (dir === 'unlock' || dir === 'rejected') return `+${n}`;
    if (dir === 'lock' || dir === 'debit' || dir === 'approved') return `−${n}`;
    return n;
  }
  const positive = ['credit', 'unlock'].includes(String(row.direction || '').toLowerCase());
  const dec = row.asset === 'USDT' ? 4 : 6;
  const n = Number(row.amount || 0).toFixed(dec);
  return `${positive ? '+' : '−'}${n}`;
}
