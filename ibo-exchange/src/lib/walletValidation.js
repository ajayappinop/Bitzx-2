/**
 * Deposit / withdrawal client validation.
 * Backend: DepositCreate amount > 0, tx_hash min 4; WithdrawalCreate amount > 0, address min 5;
 * withdraw_min_usdt from platform controls (often 0). UI copy requests ≥ 10 USDT notional.
 */

export const MIN_TX_HASH_LEN = 4;
export const MIN_WITHDRAW_ADDRESS_LEN = 5;
/** Matches wallet UI "Minimum deposit / withdrawal: 10 USDT equivalent." */
export const MIN_WALLET_NOTIONAL_USDT = 10;
export const MAX_WALLET_MEMO_LEN = 200;
export const MAX_WALLET_NOTES_LEN = 2000;
export const MAX_WALLET_AMOUNT = 1e15;
export const MAX_TX_HASH_LEN = 512;
export const MAX_WITHDRAW_ADDRESS_LEN = 256;

function parsePositiveAmount(str) {
  if (str == null || String(str).trim() === '') return null;
  const n = parseFloat(String(str).replace(/,/g, '').trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

function notionalUsdt(asset, amount, priceByAsset) {
  if (asset === 'USDT') return amount;
  const px = Number(priceByAsset?.[asset] ?? 0);
  if (!Number.isFinite(px) || px <= 0) return null;
  return amount * px;
}

/**
 * @param {{ asset: string, amountStr: string, txHash: string, network: string, notes: string|null, supportedAssets: string[], priceByAsset: Record<string, number> }}
 * @returns {{ ok: boolean, errors: Record<string, string>, message: string|null }}
 */
export function validateDepositRequest({
  asset,
  amountStr,
  txHash,
  network,
  notes,
  supportedAssets,
  priceByAsset,
}) {
  const errors = {};
  const assets = new Set((supportedAssets || []).map(a => String(a).toUpperCase()));
  const a = String(asset || '').toUpperCase();
  if (!assets.has(a)) errors.asset = 'Select a supported asset.';

  const amount = parsePositiveAmount(amountStr);
  if (amount == null) {
    errors.amount = 'Enter a valid amount greater than zero.';
  } else if (amount > MAX_WALLET_AMOUNT) {
    errors.amount = 'Amount is too large.';
  } else if (a === 'USDT') {
    if (amount < MIN_WALLET_NOTIONAL_USDT) {
      errors.amount = `Minimum deposit is ${MIN_WALLET_NOTIONAL_USDT} USDT.`;
    }
  } else {
    const n = notionalUsdt(a, amount, priceByAsset || {});
    if (n == null) {
      errors.amount = 'Live price unavailable for this asset. Wait a moment and try again, or deposit USDT.';
    } else if (n < MIN_WALLET_NOTIONAL_USDT) {
      errors.amount = `Minimum is ${MIN_WALLET_NOTIONAL_USDT} USDT equivalent (your request ≈ $${n.toFixed(2)}).`;
    }
  }

  const hash = (txHash || '').trim();
  if (hash.length < MIN_TX_HASH_LEN) {
    errors.tx_hash = `Enter a transaction hash or reference (at least ${MIN_TX_HASH_LEN} characters).`;
  } else if (hash.length > MAX_TX_HASH_LEN) {
    errors.tx_hash = `Reference is too long (max ${MAX_TX_HASH_LEN} characters).`;
  }

  const net = (network || '').trim();
  if (!net) errors.network = 'Select a network.';

  const nts = notes != null ? String(notes) : '';
  if (nts.length > MAX_WALLET_NOTES_LEN) {
    errors.notes = `Notes must be ${MAX_WALLET_NOTES_LEN} characters or less.`;
  }

  const keys = ['asset', 'amount', 'tx_hash', 'network', 'notes'];
  let message = null;
  for (const k of keys) {
    if (errors[k]) {
      message = errors[k];
      break;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, message };
}

/**
 * @param {{ asset: string, amountStr: string, address: string, network: string, memo: string|null, available: number, supportedAssets: string[], priceByAsset: Record<string, number> }}
 */
export function validateWithdrawRequest({
  asset,
  amountStr,
  address,
  network,
  memo,
  available,
  supportedAssets,
  priceByAsset,
}) {
  const errors = {};
  const assets = new Set((supportedAssets || []).map(x => String(x).toUpperCase()));
  const a = String(asset || '').toUpperCase();
  if (!assets.has(a)) errors.asset = 'Select a supported asset.';

  const amount = parsePositiveAmount(amountStr);
  if (amount == null) {
    errors.amount = 'Enter a valid amount greater than zero.';
  } else if (amount > MAX_WALLET_AMOUNT) {
    errors.amount = 'Amount is too large.';
  } else {
    const avail = Number(available);
    if (Number.isFinite(avail) && amount > avail + 1e-12) {
      errors.amount = `Insufficient balance. Available: ${avail.toFixed(8)} ${a}.`;
    } else if (a === 'USDT') {
      if (amount < MIN_WALLET_NOTIONAL_USDT) {
        errors.amount = `Minimum withdrawal is ${MIN_WALLET_NOTIONAL_USDT} USDT.`;
      }
    } else {
      const n = notionalUsdt(a, amount, priceByAsset || {});
      if (n == null) {
        errors.amount = 'Live price unavailable. Wait and retry, or withdraw USDT.';
      } else if (n < MIN_WALLET_NOTIONAL_USDT) {
        errors.amount = `Minimum is ${MIN_WALLET_NOTIONAL_USDT} USDT equivalent (yours ≈ $${n.toFixed(2)}).`;
      }
    }
  }

  const addr = (address || '').trim();
  if (addr.length < MIN_WITHDRAW_ADDRESS_LEN) {
    errors.address = `Enter a valid destination address (at least ${MIN_WITHDRAW_ADDRESS_LEN} characters).`;
  } else if (addr.length > MAX_WITHDRAW_ADDRESS_LEN) {
    errors.address = `Address is too long (max ${MAX_WITHDRAW_ADDRESS_LEN} characters).`;
  }

  const net = (network || '').trim();
  if (!net) errors.network = 'Select a network.';

  const m = memo != null ? String(memo) : '';
  if (m.length > MAX_WALLET_MEMO_LEN) {
    errors.memo = `Memo must be ${MAX_WALLET_MEMO_LEN} characters or less.`;
  }

  const keys = ['asset', 'amount', 'address', 'network', 'memo'];
  let message = null;
  for (const k of keys) {
    if (errors[k]) {
      message = errors[k];
      break;
    }
  }
  return { ok: Object.keys(errors).length === 0, errors, message };
}
