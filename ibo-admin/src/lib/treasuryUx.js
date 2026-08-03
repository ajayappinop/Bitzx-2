/**
 * Plain-language explanations for treasury / hot-wallet gate codes from the API.
 * Keeps admin copy consistent across Withdrawals and Hot & cold wallets pages.
 */

const GATE_LONG = {
  no_hot_wallet:
    'No enabled hot wallet is registered for this coin + network. Go to Hot & Cold Wallets → Add wallet address → set type=Hot and paste the exact address the server uses to sign payouts for this coin.',
  signer_not_configured:
    'The backend has no signing key configured for this coin (e.g. BSC_PRIVATE_KEY or IBO_TREASURY_PRIVATE_KEY env var is missing). Set the env var and restart the server, then add the matching hot wallet here.',
  hot_signer_mismatch:
    'The registered hot wallet address does not match the on-chain signing address in server config. Disable the wrong row and add a new hot wallet row whose address exactly matches the server signing key.',
};

/**
 * EVM assets that support live sweeping (native + token).
 * BTC / TRX / SOL require their own sweep logic (not yet implemented).
 */
export const LIVE_SWEEP_SUPPORTED = new Set([
  'ETH|ERC-20 (Ethereum)',
  'USDT|ERC-20 (Ethereum)',
  'IBO|BEP-20 (BNB Chain)',
  'USDT|BEP-20 (BNB Chain)',
]);

/** Returns true if this asset+network supports live sweep. */
export function isSweepSupported(asset, network) {
  return LIVE_SWEEP_SUPPORTED.has(`${(asset || '').toUpperCase()}|${network || ''}`);
}

/**
 * Short label for tables and badges (one line).
 * @param {string|null|undefined} code
 * @returns {string}
 */
export function shortTreasuryGateLabel(code) {
  const c = String(code || '').trim().toLowerCase();
  if (c === 'no_hot_wallet') return 'No hot wallet set up';
  if (c === 'signer_not_configured') return 'Server signing key missing';
  if (c === 'hot_signer_mismatch') return 'Address does not match server key';
  if (!c) return '—';
  return code;
}

/**
 * Longer sentence for tooltips and help text.
 * @param {string|null|undefined} code
 * @returns {string}
 */
export function describeTreasuryGateReason(code) {
  const c = String(code || '').trim().toLowerCase();
  if (GATE_LONG[c]) return GATE_LONG[c];
  if (!c) return '';
  return `Technical code: ${code}. Check the Hot & Cold Wallets page and server configuration.`;
}

/**
 * Human reason why a deposit-sweep preview row is not sweepable.
 * Also interprets the live-sweep result (row.result) for post-sweep rows.
 */
export function sweepPreviewIssue(row) {
  if (!row) return { code: 'unknown', label: '—', detail: '' };

  // ── post-sweep result (live or dry-run already ran) ─────────────────────
  const res = row.result;
  if (res && !res.ok) {
    const err = String(res.error || '');
    if (err.startsWith('insufficient_gas')) {
      const sym = res.native_symbol || 'gas';
      const need = res.native_need_human != null ? res.native_need_human.toFixed(6) : '?';
      const have = res.native_have_human != null ? res.native_have_human.toFixed(6) : '0';
      return {
        code: 'insufficient_gas',
        label: `No ${sym} for gas`,
        detail:
          `This deposit address holds ${row.asset} tokens but has insufficient ${sym} to pay for the sweep transaction gas. ` +
          `It has ${have} ${sym} but needs ~${need} ${sym}. ` +
          `Send a small amount of ${sym} to this deposit address from your hot wallet, then re-run the sweep.`,
        gas_info: { sym, need, have, address: res.deposit_address || row.address },
      };
    }
    if (err.includes('not_supported') || err.includes('not_implemented')) {
      const ast = String(row.asset || '').toUpperCase();
      return {
        code: 'sweep_not_implemented',
        label: 'Not sweepable yet',
        detail: `Live deposit sweep for ${ast} is not yet implemented. BTC, TRX, and SOL require their own signing infrastructure.`,
      };
    }
    if (err === 'token_balance_zero') {
      return {
        code: 'below_min',
        label: 'Empty balance',
        detail: 'Token balance is zero on-chain. Nothing to sweep.',
      };
    }
    return {
      code: 'sweep_error',
      label: 'Sweep failed',
      detail: `Sweep returned an error: ${err}`,
    };
  }

  // ── pre-sweep: gate blocks, balance checks ──────────────────────────────
  if (row.gate_block) {
    return {
      code: row.gate_block,
      label: shortTreasuryGateLabel(row.gate_block),
      detail: describeTreasuryGateReason(row.gate_block),
    };
  }
  if (row.balance_human == null) {
    return {
      code: 'balance_unavailable',
      label: 'Balance not available',
      detail: 'Could not read on-chain balance (RPC/contract config). Address may still be empty.',
    };
  }
  const bal = Number(row.balance_human);
  const min = Number(row.min_human ?? 0);
  if (!Number.isFinite(bal) || bal <= min) {
    return {
      code: 'below_min',
      label: 'Empty or below minimum',
      detail: min > 0
        ? `On-chain balance is ${bal} — minimum to sweep is ${min}.`
        : 'This deposit address has no spendable balance on-chain right now.',
    };
  }
  const ast = String(row.asset || '').toUpperCase();
  const net = String(row.network || '');
  if (!isSweepSupported(ast, net)) {
    return {
      code: 'sweep_not_implemented',
      label: 'Not sweepable yet',
      detail: `Live deposit sweep for ${ast} (${net || 'unknown network'}) is not yet implemented. BTC, TRX and SOL require separate signing infrastructure.`,
    };
  }
  return { code: 'ready', label: '—', detail: '' };
}
