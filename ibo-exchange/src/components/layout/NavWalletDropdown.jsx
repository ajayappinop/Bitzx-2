/**
 * Navbar wallet balance dropdown — Account Value, Spot / FNO wallets, funds CTAs.
 * Modeled after Delta Exchange India wallet popover.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Eye, EyeOff, Info, Plus, ChevronRight, ChevronDown,
} from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { futuresApi } from '@/services/futuresApi';

const USD_INR = 85;
const PANEL_WIDTH = 340;
const EDGE = 8;

function num(v) {
  const n = typeof v === 'string' ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : 0;
}

function fmtMoney(n, dp = 2) {
  return num(n).toLocaleString(undefined, {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

function DualAmount({ inr, usd, hidden, large }) {
  if (hidden) {
    return (
      <div className={`nav-wallet-amt${large ? ' is-large' : ''}`}>
        <span className="nav-wallet-amt__inr">••••</span>
        <span className="nav-wallet-amt__usd">••••</span>
      </div>
    );
  }
  return (
    <div className={`nav-wallet-amt${large ? ' is-large' : ''}`}>
      <span className="nav-wallet-amt__inr">₹{fmtMoney(inr)}</span>
      <span className="nav-wallet-amt__usd">${fmtMoney(usd)}</span>
    </div>
  );
}

function WalletRow({ label, inr, usd, hidden, href, badge, chevron = 'right', tip, onClick }) {
  const body = (
    <>
      <span className="nav-wallet-row__left">
        <span className={`nav-wallet-row__label${tip ? ' has-tip' : ''}`} title={tip || undefined}>
          {label}
        </span>
        {badge ? <span className="nav-wallet-row__badge">{badge}</span> : null}
        {chevron === 'down' ? (
          <ChevronDown size={14} className="nav-wallet-row__chev" aria-hidden />
        ) : chevron === 'right' ? (
          <ChevronRight size={14} className="nav-wallet-row__chev" aria-hidden />
        ) : null}
      </span>
      <DualAmount inr={inr} usd={usd} hidden={hidden} />
    </>
  );

  if (href) {
    return (
      <Link to={href} className="nav-wallet-row" onClick={onClick}>
        {body}
      </Link>
    );
  }
  return (
    <div className="nav-wallet-row is-static">
      {body}
    </div>
  );
}

export default function NavWalletDropdown({ className = '' }) {
  const { balance, fetchWallet } = useAuth();
  const [open, setOpen] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [fnoOpen, setFnoOpen] = useState(true);
  const [fut, setFut] = useState(null);
  const [pos, setPos] = useState({ top: 0, left: 0 });
  const triggerRef = useRef(null);
  const panelRef = useRef(null);

  const spotInr = num(balance?.INR);
  const spotUsdt = num(balance?.USDT);

  const futAvail = num(fut?.available ?? fut?.wallet_balance);
  const futUsed = num(fut?.used_margin);
  const futUnreal = num(fut?.unrealized_pnl);

  const spotUsd = spotInr / USD_INR + spotUsdt;
  const futUsd = futAvail + futUsed;
  const accountUsd = spotUsd + futUsd + futUnreal;
  const accountInr = accountUsd * USD_INR;

  const spotWalletInr = spotInr + spotUsdt * USD_INR;
  const fnoInr = futUsd * USD_INR;
  const marginInr = futAvail * USD_INR;

  const loadFutures = useCallback(async () => {
    try {
      const w = await futuresApi.wallet();
      setFut(w);
    } catch {
      setFut(null);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    fetchWallet?.();
    void loadFutures();
    return undefined;
  }, [open, fetchWallet, loadFutures]);

  const place = useCallback(() => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let left = r.right - PANEL_WIDTH;
    left = Math.max(EDGE, Math.min(left, window.innerWidth - PANEL_WIDTH - EDGE));
    setPos({ top: r.bottom + EDGE, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return undefined;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  useEffect(() => {
    if (!open) return undefined;
    const onDoc = (e) => {
      if (triggerRef.current?.contains(e.target)) return;
      if (panelRef.current?.contains(e.target)) return;
      setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const close = () => setOpen(false);

  const triggerInr = num(balance?.INR ?? balance?.USDT ?? 0);
  const triggerLabel = hidden
    ? '••••'
    : triggerInr.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className={`nav-wallet-root ${className}`.trim()}>
      <button
        type="button"
        ref={triggerRef}
        className={`delta-nav-balance nav-wallet-trigger${open ? ' is-open' : ''}`}
        title="Wallet balance"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="delta-nav-balance__rupee" aria-hidden>₹</span>
        <span className="delta-nav-balance__amt tabular-nums">{triggerLabel}</span>
      </button>

      {typeof document !== 'undefined' && createPortal(
        <AnimatePresence>
          {open ? (
            <motion.div
              ref={panelRef}
              role="dialog"
              aria-label="Wallet summary"
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.98 }}
              transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
              className="nav-wallet-panel"
              style={{ top: pos.top, left: pos.left, width: PANEL_WIDTH }}
            >
              <div className="nav-wallet-hero">
                <div className="nav-wallet-hero__head">
                  <button
                    type="button"
                    className="nav-wallet-hero__label"
                    onClick={() => setHidden((h) => !h)}
                    title={hidden ? 'Show balances' : 'Hide balances'}
                  >
                    Account Value
                    {hidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                  <Link to="/account/pnl" className="nav-wallet-pnl" onClick={close}>
                    PNL Analytics
                    <ChevronRight size={13} strokeWidth={2.4} />
                  </Link>
                </div>

                <DualAmount inr={accountInr} usd={accountUsd} hidden={hidden} large />

                <div className="nav-wallet-actions">
                  <Link to="/account/deposits" className="nav-wallet-btn nav-wallet-btn--primary" onClick={close}>
                    <Plus size={15} strokeWidth={2.5} />
                    Add Funds
                  </Link>
                  <Link to="/account/withdrawals" className="nav-wallet-btn nav-wallet-btn--ghost" onClick={close}>
                    Withdraw
                  </Link>
                </div>
              </div>

              <div className="nav-wallet-list">
                <button
                  type="button"
                  className="nav-wallet-row nav-wallet-row--toggle"
                  onClick={() => setFnoOpen((v) => !v)}
                  aria-expanded={fnoOpen}
                >
                  <span className="nav-wallet-row__left">
                    <span className="nav-wallet-row__label has-tip" title="Futures & options margin wallet">
                      FNO Wallet
                    </span>
                    <span className="nav-wallet-row__badge">Primary</span>
                    <ChevronDown
                      size={14}
                      className={`nav-wallet-row__chev${fnoOpen ? ' is-open' : ''}`}
                      aria-hidden
                    />
                  </span>
                  <DualAmount inr={fnoInr} usd={futUsd} hidden={hidden} />
                </button>

                {fnoOpen ? (
                  <WalletRow
                    label="Available Margin"
                    inr={marginInr}
                    usd={futAvail}
                    hidden={hidden}
                    href="/account/balances?wallet=fno"
                    onClick={close}
                    chevron={null}
                    tip="USDT free to open futures positions"
                  />
                ) : null}

                <WalletRow
                  label="Spot Wallet"
                  inr={spotWalletInr}
                  usd={spotUsd}
                  hidden={hidden}
                  href="/account/balances?wallet=spot"
                  onClick={close}
                  tip="INR, USDT and crypto held for spot trading"
                />

                <WalletRow
                  label="Fee Voucher"
                  inr={0}
                  usd={0}
                  hidden={hidden}
                  href="/account/balances?wallet=voucher"
                  onClick={close}
                  chevron="right"
                  tip="Trading fee credits (when issued)"
                />
              </div>

              <div className="nav-wallet-footer">
                <span>Conversion Rate: 1 USD = INR {USD_INR}</span>
                <span
                  className="nav-wallet-footer__i"
                  title="Indicative rate used for dual-currency display. Live settlement may differ."
                >
                  <Info size={12} strokeWidth={2.4} />
                </span>
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>,
        document.body,
      )}
    </div>
  );
}
