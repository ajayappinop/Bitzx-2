import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeft, IndianRupee,
} from 'lucide-react';
import { useToast } from '@/context/ToastContext';
import {
  fetchInrDepositConfig,
  fetchInrPaymentMethods,
  startInrGatewayDeposit,
  submitInrDeposit,
} from '@/services/inrApi';
import PaymentDetailsPanel from '@/components/inr/deposit/PaymentDetailsPanel';
import SubmitProofForm from '@/components/inr/deposit/SubmitProofForm';
import { parseAmount, resolveMinDepositInr, UTR_PATTERN, validateMinDepositAmount } from '@/components/inr/deposit/utils';
import { formatInrAmount } from '@/lib/inrDisplay';
import InrDepositSkeleton from '@/components/inr/deposit/InrDepositSkeleton';
import { AmountBelowMinPill } from '@/components/inr/deposit/MinDepositHints';
import { INR_BTN_PRIMARY, INR_CONTAINER, INR_INPUT, INR_PAGE_BG } from '@/components/inr/deposit/styles';

const TYPE_ORDER = ['qr', 'upi', 'bank'];

function firstMethodIdForType(methods, type) {
  return methods.find((m) => m.type === type)?.id || '';
}

export default function InrDepositPage() {
  const toast = useToast();
  const [methods, setMethods] = useState([]);
  const [depositConfig, setDepositConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [gatewayPaying, setGatewayPaying] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [utrError, setUtrError] = useState('');
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);

  const [activeType, setActiveType] = useState('');
  const [activeId, setActiveId] = useState('');
  const [amountInr, setAmountInr] = useState('');
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [utr, setUtr] = useState('');
  const [note, setNote] = useState('');
  const [screenshot, setScreenshot] = useState(null);
  const [preview, setPreview] = useState('');

  const [configLoaded, setConfigLoaded] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    setOk('');
    setConfigLoaded(false);
    try {
      const m = await fetchInrPaymentMethods();
      setMethods(m);
      if (m.length) {
        const types = TYPE_ORDER.filter((t) => m.some((x) => x.type === t));
        const type = types[0] || m[0].type;
        const id = firstMethodIdForType(m, type) || m[0].id;
        setActiveType(type);
        setActiveId(id);
        setPaymentMethodId(id);
      }

      try {
        const cfg = await fetchInrDepositConfig();
        setDepositConfig(cfg);
      } catch (cfgErr) {
        setDepositConfig(null);
        setErr(cfgErr.message || 'Could not load INR deposit settings');
      } finally {
        setConfigLoaded(true);
      }
    } catch (e) {
      setErr(e.message || 'Could not load INR deposit options');
      setConfigLoaded(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const activeMethod = useMemo(
    () => methods.find((m) => m.id === activeId) || methods[0],
    [methods, activeId],
  );

  const syncTypeAndMethod = useCallback((type, methodId) => {
    setActiveType(type);
    setActiveId(methodId);
    setPaymentMethodId(methodId);
  }, []);

  const onTypeChange = (type) => {
    const id = firstMethodIdForType(methods, type);
    if (id) syncTypeAndMethod(type, id);
  };

  const onPaymentMethodChange = (id) => {
    const m = methods.find((x) => x.id === id);
    if (m) syncTypeAndMethod(m.type, id);
  };

  const onFile = (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) {
      setErr('Screenshot must be 5MB or smaller');
      toast.error('File too large', 'Maximum size is 5MB');
      return;
    }
    if (!f.type.startsWith('image/')) {
      setErr('Screenshot must be an image (JPEG, PNG, or WebP)');
      toast.error('Invalid file', 'Use PNG, JPG, or WEBP');
      return;
    }
    setScreenshot(f);
    if (preview) URL.revokeObjectURL(preview);
    setPreview(URL.createObjectURL(f));
    setErr('');
    toast.success('Screenshot added', 'Ready to submit with your deposit proof');
  };

  const onClearFile = () => {
    setScreenshot(null);
    if (preview) URL.revokeObjectURL(preview);
    setPreview('');
  };

  const manualEnabled = configLoaded && depositConfig?.manual_enabled !== false;
  const gatewayEnabled = configLoaded && !!depositConfig?.gateway_enabled;
  const gatewayReady = configLoaded && !!depositConfig?.gateway_ready;
  const gatewayMisconfigured = configLoaded && !!depositConfig?.gateway_misconfigured;
  const gatewayOnly = gatewayEnabled && !manualEnabled;
  const gatewayOnlyPending = gatewayOnly && gatewayMisconfigured && !gatewayReady;
  const settingsReady = configLoaded && depositConfig != null;
  const minDepositInr = useMemo(() => resolveMinDepositInr(depositConfig), [depositConfig]);

  const validateDepositAmount = (rawAmount) =>
    validateMinDepositAmount(parseAmount(rawAmount), minDepositInr, formatInrAmount);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setErr('');
    setOk('');
    if (!settingsReady) {
      setErr('Deposit settings could not be loaded. Refresh the page and try again.');
      return;
    }
    const amountError = validateDepositAmount(amountInr);
    if (amountError) {
      setErr(amountError);
      return;
    }
    const amt = parseAmount(amountInr);
    if (!paymentMethodId) {
      setErr('Select the payment method you used');
      return;
    }
    const utrTrim = utr.trim();
    if (!utrTrim) {
      setErr('UTR / reference number is required');
      return;
    }
    if (!UTR_PATTERN.test(utrTrim)) {
      setUtrError('Enter a valid UTR (6–22 letters or numbers)');
      return;
    }
    if (!screenshot) {
      setErr('Payment screenshot is required');
      return;
    }

    const fd = new FormData();
    fd.append('amount_inr', String(amt));
    fd.append('payment_method_id', paymentMethodId);
    fd.append('utr_number', utrTrim);
    if (note.trim()) fd.append('note', note.trim());
    fd.append('screenshot', screenshot);

    setSubmitting(true);
    setUploadProgress(12);
    const tick = setInterval(() => {
      setUploadProgress((p) => (p >= 88 ? p : p + 8));
    }, 120);

    try {
      const data = await submitInrDeposit(fd);
      setUploadProgress(100);
      setOk(data.message || 'Your deposit request has been submitted and is under review.');
      toast.success('Deposit submitted', 'We will verify your payment shortly.');
      setAmountInr('');
      setUtr('');
      setNote('');
      onClearFile();
    } catch (ex) {
      setErr(ex.message || 'Could not submit deposit');
      toast.error('Submission failed', ex.message || 'Please try again');
      setUploadProgress(0);
    } finally {
      clearInterval(tick);
      setSubmitting(false);
      setTimeout(() => setUploadProgress(0), 600);
    }
  };

  const handleGatewayPay = async () => {
    setErr('');
    setOk('');
    if (!settingsReady) {
      setErr('Deposit settings could not be loaded. Refresh the page and try again.');
      return;
    }
    const amountError = validateDepositAmount(amountInr);
    if (amountError) {
      setErr(amountError);
      return;
    }
    const amt = parseAmount(amountInr);
    setGatewayPaying(true);
    try {
      const data = await startInrGatewayDeposit({
        amount_inr: amt,
        payment_method_id: paymentMethodId || null,
      });
      if (data.checkout_url) {
        window.location.href = data.checkout_url;
        return;
      }
      setOk(data.message || 'Payment session created. Complete checkout to finish your deposit.');
      toast.info('Checkout started', 'Complete payment in the gateway window');
    } catch (ex) {
      setErr(ex.message || 'Could not start payment');
      toast.error('Payment failed', ex.message || 'Could not start checkout');
    } finally {
      setGatewayPaying(false);
    }
  };

  if (loading) {
    return (
      <div className={INR_PAGE_BG}>
        <InrDepositSkeleton />
      </div>
    );
  }

  return (
    <div className={INR_PAGE_BG}>
      <div className={INR_CONTAINER}>
        {/* Header */}
        <motion.header
          initial={{ opacity: 0, y: -12 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-8 lg:mb-10"
        >
          <Link
            to="/wallet?tab=deposit"
            className="inline-flex items-center gap-2 text-sm text-white/55 hover:text-gold-light mb-5 transition-colors"
          >
            <ArrowLeft size={18} /> Back to wallet
          </Link>
          <div>
            <h1 className="text-3xl sm:text-4xl font-normal text-white tracking-tight flex items-center gap-3">
              <span className="flex h-12 w-12 items-center justify-center rounded-xl bg-gold/15 border border-gold/25">
                <IndianRupee className="text-gold-light" size={26} />
              </span>
              Deposit INR
            </h1>
            <p className="text-base text-white/55 mt-3 max-w-xl leading-relaxed">
              Transfer funds securely and submit proof for verification.
            </p>
          </div>
        </motion.header>

        <AnimatePresence mode="wait">
          {err && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 rounded-[18px] border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200"
            >
              {err}
            </motion.div>
          )}
          {ok && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-6 rounded-[18px] border border-emerald-500/30 bg-emerald-500/10 px-5 py-4 text-sm text-emerald-100"
            >
              {ok}{' '}
              <Link to="/wallet?tab=ledger" className="text-gold-light underline">
                View in activity ledger →
              </Link>
            </motion.div>
          )}
        </AnimatePresence>

        {configLoaded && !depositConfig ? (
          <div className="mb-6 rounded-[18px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-gold-light/90">
            Deposit settings could not be loaded. Minimum rules still apply on the server — refresh to retry.
          </div>
        ) : null}

        {!gatewayOnlyPending && methods.length === 0 && (
          <div className="rounded-2xl border border-surface-border bg-surface-card p-8 text-center text-[15px] text-[color:var(--ibo-ink-secondary)]">
            INR deposits are not available right now. Please use on-chain deposit from your wallet.
          </div>
        )}

        {gatewayOnlyPending && (
          <div className="mb-6 rounded-[18px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-gold-light/90">
            Automatic payments are being configured. Try again later.
          </div>
        )}

        {gatewayEnabled && gatewayMisconfigured && !gatewayOnly && (
          <div className="mb-6 rounded-[18px] border border-gold/30 bg-gold/10 px-5 py-4 text-sm text-gold-light/90">
            Automatic payments are being configured. Use manual deposit below, or try again later.
          </div>
        )}

        {!gatewayOnlyPending && gatewayEnabled && gatewayReady && (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 rounded-2xl border border-surface-border bg-surface-card p-6 sm:p-8 space-y-4"
          >
            <h2 className="text-xl font-normal text-white">Pay with payment gateway</h2>
            <p className="text-sm text-white/50">Redirect to checkout — no screenshot required.</p>
            <div className="max-w-md">
              <label className="block text-[11px] font-normal uppercase tracking-wider text-white/50 mb-2">
                Amount (INR)
              </label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-gold-light">₹</span>
                <input
                  type="text"
                  value={amountInr}
                  onChange={(e) => setAmountInr(e.target.value)}
                  className={`${INR_INPUT} pl-10`}
                />
              </div>
              <div className="mt-2 min-h-[28px]">
                <AmountBelowMinPill amountRaw={amountInr} minDepositInr={minDepositInr} />
              </div>
            </div>
            <button
              type="button"
              onClick={handleGatewayPay}
              disabled={gatewayPaying || !settingsReady}
              className={`px-8 py-3.5 ${INR_BTN_PRIMARY} w-auto inline-flex`}
            >
              {gatewayPaying ? 'Starting checkout…' : 'Continue to payment'}
            </button>
          </motion.div>
        )}

        {!gatewayOnlyPending && manualEnabled && methods.length > 0 && (
          <>
            {gatewayEnabled && gatewayReady && (
              <p className="text-xs font-normal uppercase tracking-[0.2em] text-white/35 mb-4">
                Or pay manually
              </p>
            )}

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:gap-8 xl:gap-10 items-start">
              <PaymentDetailsPanel
                methods={methods}
                activeType={activeType}
                onTypeChange={onTypeChange}
                activeMethod={activeMethod}
                onMethodChange={onPaymentMethodChange}
                collapsed={detailsCollapsed}
                onToggleCollapse={() => setDetailsCollapsed((c) => !c)}
                showMobileCollapse
                minDepositInr={minDepositInr}
              />

              <SubmitProofForm
                methods={methods}
                amountInr={amountInr}
                onAmountChange={setAmountInr}
                minDepositInr={minDepositInr}
                settingsReady={settingsReady}
                paymentMethodId={paymentMethodId}
                onPaymentMethodChange={onPaymentMethodChange}
                utr={utr}
                onUtrChange={setUtr}
                note={note}
                onNoteChange={setNote}
                screenshot={screenshot}
                preview={preview}
                onFile={onFile}
                onClearFile={onClearFile}
                submitting={submitting}
                uploadProgress={uploadProgress}
                onSubmit={handleSubmit}
                utrError={utrError}
                setUtrError={setUtrError}
              />
            </div>
          </>
        )}

        {/* Mobile sticky CTA */}
        {!gatewayOnlyPending && manualEnabled && methods.length > 0 && (
          <div className="lg:hidden fixed bottom-0 left-0 right-0 z-50 p-4 bg-gradient-to-t from-surface-dark via-surface-dark to-transparent pointer-events-none">
            <button
              type="button"
              onClick={() => document.getElementById('inr-submit-form')?.requestSubmit()}
              disabled={submitting || !settingsReady}
              className={`pointer-events-auto ${INR_BTN_PRIMARY}`}
            >
              {submitting ? 'Submitting…' : 'Submit Deposit Request'}
            </button>
          </div>
        )}
      </div>
      <div className="h-24 lg:hidden" aria-hidden />
    </div>
  );
}
