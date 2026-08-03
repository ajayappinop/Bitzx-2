/** Client-side checks aligned with backend listings/validators.py */

const SYMBOL_RE = /^[A-Z0-9]{2,12}$/;
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const ETH_RE = /^0x[a-fA-F0-9]{40}$/;

const NETWORKS = new Set([
  'Bitcoin Network',
  'ERC-20 (Ethereum)',
  'BEP-20 (BNB Chain)',
  'TRC-20 (Tron)',
  'Solana',
]);

function normUrl(raw, required) {
  const s = (raw || '').trim();
  if (!s) return required ? { ok: false, msg: 'URL is required' } : { ok: true, value: '' };
  const withScheme = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const u = new URL(withScheme);
    if (!['http:', 'https:'].includes(u.protocol) || !u.hostname) {
      return { ok: false, msg: 'Invalid URL' };
    }
    return { ok: true, value: withScheme.slice(0, 512) };
  } catch {
    return { ok: false, msg: 'Invalid URL' };
  }
}

function validateContract(network, address) {
  const addr = (address || '').trim();
  if (!addr) return 'Contract address is required';
  if (network === 'ERC-20 (Ethereum)' || network === 'BEP-20 (BNB Chain)') {
    if (!ETH_RE.test(addr)) return 'Invalid EVM contract address (0x + 40 hex characters)';
    return null;
  }
  if (!NETWORKS.has(network)) return 'Invalid blockchain network';
  return null;
}

/**
 * @returns {string|null} Error message or null if valid
 */
export function validateListingForm(form) {
  const pn = (form.project_name || '').trim();
  const tn = (form.token_name || '').trim();
  const sym = (form.token_symbol || '').trim().toUpperCase();
  const net = (form.blockchain_network || '').trim();
  const email = (form.contact_email || '').trim().toLowerCase();
  const desc = (form.description || '').trim();

  if (pn.length < 2 || pn.length > 120) return 'Project name must be 2–120 characters';
  if (tn.length < 2 || tn.length > 80) return 'Token name must be 2–80 characters';
  if (!SYMBOL_RE.test(sym)) return 'Token symbol must be 2–12 uppercase letters or digits';
  if (!NETWORKS.has(net)) return 'Please select a supported blockchain network';
  const contractErr = validateContract(net, form.contract_address);
  if (contractErr) return contractErr;
  const dex = normUrl(form.dex_swap_link, true);
  if (!dex.ok) return `DEX swap link: ${dex.msg}`;
  const site = normUrl(form.official_website, true);
  if (!site.ok) return `Official website: ${site.msg}`;
  if (!EMAIL_RE.test(email)) return 'Enter a valid contact email';
  if (desc.length < 20 || desc.length > 2000) return 'Description must be 20–2000 characters';
  return null;
}
