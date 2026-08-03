import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, IndianRupee, Building2, Smartphone, AlertCircle, Pencil, ShieldCheck, ShieldAlert } from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import {
  fetchInrWithdrawalEligibility,
  fetchInrRate,
  saveInrPayoutProfile,
  submitInrWithdrawal,
} from '@/services/inrApi';
import { parseAmount } from '@/components/inr/deposit/utils';
import InrDepositSkeleton from '@/components/inr/deposit/InrDepositSkeleton';
import {
  INR_BTN_PRIMARY,
  INR_CONTAINER,
  INR_INPUT,
  INR_LABEL,
  INR_PAGE_BG,
  INR_TAB_ACTIVE,
  INR_TAB_IDLE,
  INR_CARD,
  INR_CARD_GLOW,
} from '@/components/inr/deposit/styles';

const PAYOUT_TYPES = [
  { id: 'bank', label: 'Bank account', icon: Building2 },
  { id: 'upi', label: 'UPI', icon: Smartphone },
];

const EMPTY_BANK = {
  bank_name: '',
  account_holder_name: '',
  account_number: '',
  ifsc_code: '',
  branch: '',
};

const EMPTY_UPI = {
  upi_id: '',
  display_name: '',
};

function fmtInr(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return '—';
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function bankSummary(bank) {
  if (!bank) return null;
  const tail = bank.account_number_masked || (bank.account_number ? `••••${String(bank.account_number).slice(-4)}` : '');
  return `${bank.bank_name || 'Bank'} · ${bank.account_holder_name || '—'}${tail ? ` · ${tail}` : ''}`;
}

function upiSummary(upi) {
  if (!upi) return null;
  return `${upi.display_name || '—'} · ${upi.upi_id || '—'}`;
}

function validateBankForm(bank) {
  if (!bank.bank_name?.trim() || !bank.account_holder_name?.trim()
    || !bank.account_number?.trim() || !bank.ifsc_code?.trim()) {
    return 'Fill all required bank fields';
  }
  if (bank.ifsc_code.trim().length !== 11) return 'IFSC must be 11 characters';
  return null;
}

function validateUpiForm(upi) {
  if (!upi.upi_id?.trim() || !upi.display_name?.trim()) {
    return 'UPI ID and account holder name are required';
  }
  if (!upi.upi_id.includes('@')) return 'Enter a valid UPI ID (must contain @)';
  return null;
}

function bankPayload(bank) {
  return {
    bank_name: bank.bank_name.trim(),
    account_holder_name: bank.account_holder_name.trim(),
    account_number: bank.account_number.trim(),
    ifsc_code: bank.ifsc_code.trim().toUpperCase(),
    ...(bank.branch?.trim() ? { branch: bank.branch.trim() } : {}),
  };
}

function upiPayload(upi) {
  return {
    upi_id: upi.upi_id.trim(),
    display_name: upi.display_name.trim(),
  };
}

export default function InrWithdrawPage() {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [eligibility, setEligibility] = useState(null);
  const [rate, setRate] = useState(null);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const [payoutType, setPayoutType] = useState('bank');
  const [amountInr, setAmountInr] = useState('');
  const [editingPayout, setEditingPayout] = useState(false);
  const [bank, setBank] = useState(EMPTY_BANK);
  const [upi, setUpi] = useState(EMPTY_UPI);

  const profile = eligibility?.payout_profile;
  const hasSavedBank = !!profile?.has_bank;
  const hasSavedUpi = !!profile?.has_upi;
  const hasSavedForType = payoutType === 'bank' ? hasSavedBank : hasSavedUpi;

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const [elig, r] = await Promise.all([
        fetchInrWithdrawalEligibility(),
        fetchInrRate().catch(() => null),
      ]);
      setEligibility(elig);
      setRate(r);
      const pp = elig?.payout_profile;
      if (pp?.bank) {
        setBank({
          bank_name: pp.bank.bank_name || '',
          account_holder_name: pp.bank.account_holder_name || '',
          account_number: pp.bank.account_number || '',
          ifsc_code: pp.bank.ifsc_code || '',
          branch: pp.bank.branch || '',
        });
      }
      if (pp?.upi) {
        setUpi({
          upi_id: pp.upi.upi_id || '',
          display_name: pp.upi.display_name || '',
        });
      }
      if (pp?.has_bank) setPayoutType('bank');
      else if (pp?.has_upi && !pp?.has_bank) setPayoutType('upi');
      setEditingPayout(!(pp?.has_bank || pp?.has_upi));
    } catch (e) {
      setErr(e.message || 'Could not load INR withdrawal');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!hasSavedForType) {
      setEditingPayout(true);
    }
  }, [payoutType, hasSavedForType]);

  const amt = parseAmount(amountInr);
  const maxWithdrawInr = useMemo(() => {
    const fromApi = Number(eligibility?.max_withdrawal_inr);
    if (Number.isFinite(fromApi) && fromApi >= 0) return fromApi;
    const depositCap = Number(eligibility?.available_inr_limit);
    return Number.isFinite(depositCap) ? depositCap : 0;
  }, [eligibility]);

  const previewIbo = useMemo(() => {
    if (!Number.isFinite(amt) || amt <= 0 || !rate?.ibo_per_inr) return null;
    return amt * Number(rate.ibo_per_inr);
  }, [amt, rate]);

  const iboAvailable = Number(eligibility?.ibo_balance_available);
  const iboBlocksMax = Number.isFinite(iboAvailable)
    && Number(eligibility?.inr_limit_from_ibo_balance) + 0.01
      < Number(eligibility?.available_inr_limit);

  const onSavePayoutOnly = async () => {
    setErr('');
    let details;
    if (payoutType === 'bank') {
      const vErr = validateBankForm(bank);
      if (vErr) { setErr(vErr); return; }
      details = bankPayload(bank);
    } else {
      const vErr = validateUpiForm(upi);
      if (vErr) { setErr(vErr); return; }
      details = upiPayload(upi);
    }
    setSubmitting(true);
    try {
      const data = await saveInrPayoutProfile({ payout_type: payoutType, payout_details: details });
      setEligibility((prev) => (prev ? { ...prev, payout_profile: data.payout_profile } : prev));
      setEditingPayout(false);
      toast.success('Saved', 'Payout details saved for next time');
    } catch (ex) {
      setErr(ex.message || 'Could not save');
    } finally {
      setSubmitting(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setOk('');
    if (!eligibility?.eligible) {
      setErr(eligibility?.reason || 'INR withdrawal is not available for your account.');
      return;
    }
    if (!Number.isFinite(amt) || amt <= 0) {
      setErr('Enter a valid INR amount');
      return;
    }
    if (amt > maxWithdrawInr + 0.01) {
      if (iboBlocksMax) {
        setErr(
          `Amount exceeds what your available IBO can sell (${fmtInr(maxWithdrawInr)} max; `
          + `${iboAvailable.toLocaleString('en-IN', { maximumFractionDigits: 8 })} IBO free)`,
        );
      } else {
        setErr(`Amount exceeds your limit (${fmtInr(maxWithdrawInr)} remaining)`);
      }
      return;
    }
    if (
      Number.isFinite(iboAvailable)
      && previewIbo != null
      && previewIbo > iboAvailable + 1e-8
    ) {
      setErr(
        `This amount needs ${previewIbo.toLocaleString('en-IN', { maximumFractionDigits: 8 })} IBO `
        + `but only ${iboAvailable.toLocaleString('en-IN', { maximumFractionDigits: 8 })} is available.`,
      );
      return;
    }

    let payout_details;
    if (editingPayout || !hasSavedForType) {
      if (payoutType === 'bank') {
        const vErr = validateBankForm(bank);
        if (vErr) { setErr(vErr); return; }
        payout_details = bankPayload(bank);
      } else {
        const vErr = validateUpiForm(upi);
        if (vErr) { setErr(vErr); return; }
        payout_details = upiPayload(upi);
      }
    }

    setSubmitting(true);
    try {
      const data = await submitInrWithdrawal({
        amount_inr: amt,
        payout_type: payoutType,
        ...(payout_details ? { payout_details } : {}),
        save_payout_profile: true,
      });
      setOk(data.message || 'Withdrawal submitted');
      toast.success('Submitted', 'You will receive INR after admin approval');
      setAmountInr('');
      setEditingPayout(false);
      await load();
    } catch (ex) {
      const msg = ex.message || 'Submit failed';
      setErr(msg);
      toast.error('Could not submit', msg);
    } finally {
      setSubmitting(false);
    }
  };

  const renderPayoutForm = () => (
    payoutType === 'bank' ? (
      <div className="space-y-4">
        <div>
          <label className={INR_LABEL}>Account holder name *</label>
          <input
            className={INR_INPUT}
            value={bank.account_holder_name}
            onChange={(e) => setBank((b) => ({ ...b, account_holder_name: e.target.value }))}
            autoComplete="name"
          />
        </div>
        <div>
          <label className={INR_LABEL}>Bank name *</label>
          <input className={INR_INPUT} value={bank.bank_name} onChange={(e) => setBank((b) => ({ ...b, bank_name: e.target.value }))} />
        </div>
        <div>
          <label className={INR_LABEL}>Account number *</label>
          <input
            className={INR_INPUT}
            value={bank.account_number}
            onChange={(e) => setBank((b) => ({ ...b, account_number: e.target.value }))}
            inputMode="numeric"
          />
        </div>
        <div>
          <label className={INR_LABEL}>IFSC *</label>
          <input
            className={INR_INPUT}
            value={bank.ifsc_code}
            onChange={(e) => setBank((b) => ({ ...b, ifsc_code: e.target.value.toUpperCase() }))}
            maxLength={11}
          />
        </div>
        <div>
          <label className={INR_LABEL}>Branch (optional)</label>
          <input className={INR_INPUT} value={bank.branch} onChange={(e) => setBank((b) => ({ ...b, branch: e.target.value }))} />
        </div>
      </div>
    ) : (
      <div className="space-y-4">
        <div>
          <label className={INR_LABEL}>UPI ID *</label>
          <input
            className={INR_INPUT}
            value={upi.upi_id}
            onChange={(e) => setUpi((u) => ({ ...u, upi_id: e.target.value }))}
            placeholder="yourname@bank"
          />
        </div>
        <div>
          <label className={INR_LABEL}>Account holder name *</label>
          <input
            className={INR_INPUT}
            value={upi.display_name}
            onChange={(e) => setUpi((u) => ({ ...u, display_name: e.target.value }))}
          />
        </div>
      </div>
    )
  );

  if (loading) {
    return (
      <div className={INR_PAGE_BG}>
        <div className={INR_CONTAINER}>
          <InrDepositSkeleton />
        </div>
      </div>
    );
  }

  return (
    <div className={INR_PAGE_BG}>
      <div className={INR_CONTAINER}>
        <Link
          to="/wallet?tab=withdraw"
          className="inline-flex items-center gap-2 text-sm font-bold text-gold-light hover:text-gold mb-6"
        >
          <ArrowLeft size={18} /> Back to wallet
        </Link>

        <div className="mb-8">
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white flex items-center gap-3">
            <IndianRupee className="text-gold-light" size={32} />
            Sell IBO · Receive INR
          </h1>
          <p className="text-white/55 mt-2 max-w-2xl text-sm sm:text-base">
            Sell IBO for rupees paid to your bank or UPI. This is not an on-chain withdrawal.
            Payout details are saved after your first setup.
          </p>
        </div>

        {err && (
          <div className="mb-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {err}
          </div>
        )}
        {ok && (
          <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
            {ok}
          </div>
        )}

        {!eligibility?.eligible ? (
          <div className={`${INR_CARD} ${INR_CARD_GLOW} p-8 max-w-xl`}>
            <div className="flex gap-3 text-gold-light">
              <AlertCircle size={22} className="shrink-0 mt-0.5" />
              <div>
                <p className="font-bold text-white mb-2">INR payout not available</p>
                <p className="text-sm text-white/60 leading-relaxed">
                  {eligibility?.reason || 'Complete an INR deposit and wait for approval first.'}
                </p>
                <Link to="/wallet/deposit/inr" className="inline-block mt-4 text-sm font-bold text-gold-light underline">
                  Deposit via INR →
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6 lg:gap-8">
            <div className={`lg:col-span-2 ${INR_CARD} ${INR_CARD_GLOW} p-6 sm:p-8`}>
              <form onSubmit={onSubmit} className="space-y-6">
                <div className="flex flex-wrap gap-2">
                  {PAYOUT_TYPES.map(({ id, label, icon: Icon }) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setPayoutType(id)}
                      className={`flex items-center gap-2 px-4 py-3 rounded-xl border text-sm font-bold transition-all ${
                        payoutType === id ? INR_TAB_ACTIVE : INR_TAB_IDLE
                      }`}
                    >
                      <Icon size={18} />
                      {label}
                      {id === 'bank' && hasSavedBank && (
                        <span className="text-[10px] opacity-70">saved</span>
                      )}
                      {id === 'upi' && hasSavedUpi && (
                        <span className="text-[10px] opacity-70">saved</span>
                      )}
                    </button>
                  ))}
                </div>

                {hasSavedForType && !editingPayout ? (
                  <div className="rounded-xl border border-white/10 bg-black/25 p-4 space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-white/45">Payout to</p>
                    <p className="text-sm text-white font-medium">
                      {payoutType === 'bank' ? bankSummary(profile.bank) : upiSummary(profile.upi)}
                    </p>
                    {payoutType === 'bank' && (
                      profile.bank?.bank_verified
                        ? (
                          <div className="flex items-center gap-1.5 text-xs font-bold text-emerald-400">
                            <ShieldCheck size={13} />
                            Bank account verified
                            {profile.bank?.verified_account_name && (
                              <span className="text-white/50 font-normal ml-1">
                                · {profile.bank.verified_account_name}
                              </span>
                            )}
                          </div>
                        ) : (
                          <div className="flex items-center gap-1.5 text-xs font-semibold text-gold">
                            <ShieldAlert size={13} />
                            Bank not yet verified
                          </div>
                        )
                    )}
                    <button
                      type="button"
                      onClick={() => setEditingPayout(true)}
                      className="inline-flex items-center gap-2 text-xs font-bold text-gold-light hover:underline"
                    >
                      <Pencil size={14} /> Change bank / UPI details
                    </button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <p className="text-sm text-white/55">
                      {hasSavedForType
                        ? 'Update your saved payout details below.'
                        : 'Add your payout details once — we will use them for every INR withdrawal.'}
                    </p>
                    {payoutType === 'bank' && (
                      <div className="flex items-start gap-2 rounded-xl px-3.5 py-2.5 text-xs text-emerald-300/80"
                        style={{ background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.18)' }}>
                        <ShieldCheck size={13} className="shrink-0 mt-0.5 text-emerald-400" />
                        Your account number and IFSC will be verified with your bank before saving.
                      </div>
                    )}
                    {renderPayoutForm()}
                    <button
                      type="button"
                      disabled={submitting}
                      onClick={onSavePayoutOnly}
                      className="w-full py-3 rounded-xl font-bold text-sm border border-surface-border text-white/90 hover:border-gold/40 disabled:opacity-50 inline-flex items-center justify-center gap-2"
                    >
                      {submitting && payoutType === 'bank' ? 'Verifying account…' : 'Save payout details'}
                    </button>
                    {hasSavedForType && (
                      <button
                        type="button"
                        onClick={() => setEditingPayout(false)}
                        className="text-xs font-bold text-white/50 hover:text-white underline"
                      >
                        Cancel edit
                      </button>
                    )}
                  </div>
                )}

                <div>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <label className={INR_LABEL}>Amount to receive (INR) *</label>
                    {maxWithdrawInr > 0 && (
                      <button
                        type="button"
                        onClick={() => setAmountInr(String(maxWithdrawInr))}
                        className="text-xs font-bold text-gold-light hover:text-gold"
                      >
                        Max
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gold font-bold">₹</span>
                    <input
                      className={`${INR_INPUT} pl-10`}
                      value={amountInr}
                      onChange={(e) => setAmountInr(e.target.value.replace(/[^\d.,]/g, ''))}
                      placeholder="0.00"
                    />
                  </div>
                  <p className="text-xs text-white/40 mt-2">
                    Min ₹{eligibility.min_withdrawal_inr || 100}. You can withdraw up to{' '}
                    {fmtInr(maxWithdrawInr)}
                    {iboBlocksMax && (
                      <>
                        {' '}
                        (deposit limit {fmtInr(eligibility.available_inr_limit)}; capped by available IBO)
                      </>
                    )}
                  </p>
                </div>

                {previewIbo != null && (
                  <p className="text-xs text-white/50 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
                    At the current rate, about{' '}
                    <span className="text-white/80 font-mono">
                      {previewIbo.toLocaleString('en-IN', { maximumFractionDigits: 8 })} IBO
                    </span>
                    {' '}will be reserved for this payout until it is completed or cancelled.
                  </p>
                )}

                <button type="submit" disabled={submitting} className={INR_BTN_PRIMARY}>
                  {submitting && payoutType === 'bank' && (editingPayout || !hasSavedForType)
                    ? 'Verifying & submitting…'
                    : submitting ? 'Submitting…' : 'Request INR payout'}
                </button>
              </form>
            </div>

            <div className="space-y-4">
              <div className={`${INR_CARD} p-5`}>
                <p className="text-xs font-bold uppercase tracking-wider text-white/45 mb-3">Your limits</p>
                <dl className="space-y-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <dt className="text-white/50">Approved INR deposits</dt>
                    <dd className="text-white font-mono">{fmtInr(eligibility.approved_deposit_inr_total)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-white/50">Already withdrawn</dt>
                    <dd className="text-white font-mono">{fmtInr(eligibility.approved_withdrawal_inr_total)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-white/50">From deposits</dt>
                    <dd className="text-white font-mono">{fmtInr(eligibility.available_inr_limit)}</dd>
                  </div>
                  <div className="flex justify-between gap-2">
                    <dt className="text-white/50">IBO available to sell</dt>
                    <dd className="text-white font-mono">
                      {Number.isFinite(iboAvailable)
                        ? iboAvailable.toLocaleString('en-IN', { maximumFractionDigits: 8 })
                        : '—'}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-2 border-t border-white/10 pt-2">
                    <dt className="text-gold-light font-bold">Max payout now</dt>
                    <dd className="text-gold-light font-mono font-bold">{fmtInr(maxWithdrawInr)}</dd>
                  </div>
                </dl>
              </div>

              <Link
                to="/wallet?tab=history&inr=withdraw"
                className="block text-center text-sm font-bold text-gold-light hover:underline"
              >
                View withdrawal history →
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
