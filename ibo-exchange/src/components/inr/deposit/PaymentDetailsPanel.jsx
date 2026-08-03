import { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  QrCode, Smartphone, Building2, Download, AlertTriangle,
} from 'lucide-react';
import QrEnlargeable from '@/components/ui/QrEnlargeable';
import { useToast } from '@/context/ToastContext';
import { downloadUploadAsset, uploadUrl } from '@/services/inrApi';
import { methodSelectLabel } from './utils';
import CopyField from './CopyField';
import { PaymentMinNotice } from './MinDepositHints';
import {
  INR_CARD,
  INR_CARD_GLOW,
  INR_GOLD,
  INR_INNER_PANEL,
  INR_TAB_ACTIVE,
  INR_TAB_IDLE,
} from './styles';

const TYPE_META = {
  qr: { tab: 'QR Code', icon: QrCode },
  upi: { tab: 'UPI', icon: Smartphone },
  bank: { tab: 'Bank Transfer', icon: Building2 },
};

const TYPE_ORDER = ['qr', 'upi', 'bank'];

function QrPanel({ method, minDepositInr }) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  const d = method.details || {};
  const src = uploadUrl(method.qr_image_url);
  const label = d.label?.trim() || '';

  const onDownloadQr = async () => {
    if (!method.qr_image_url || downloading) return;
    setDownloading(true);
    try {
      const base = label ? `ibo-qr-${label}` : 'ibo-qr';
      await downloadUploadAsset(method.qr_image_url, base);
      toast.success('Downloaded', 'QR image saved to your device');
    } catch (e) {
      toast.error('Download failed', e?.message || 'Could not save QR image');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <motion.div
      key="qr"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-5"
    >
      <PaymentMinNotice minDepositInr={minDepositInr} />
      {src && (
        <div className="flex flex-col items-center">
          <QrEnlargeable
            src={src}
            alt={label || 'Payment QR'}
            size={300}
            modalSize={480}
            bare
            hint="Tap to enlarge"
            modalHint="Scan to pay"
          />
        </div>
      )}
      {label ? (
        <div className={INR_INNER_PANEL}>
          <CopyField label="Label" value={label} mono={false} />
        </div>
      ) : null}
      {src && (
        <button
          type="button"
          disabled={downloading}
          onClick={onDownloadQr}
          className="w-full inline-flex items-center justify-center gap-2 py-3 rounded-xl border border-surface-border bg-surface-dark text-sm text-white hover:border-gold/30 transition-colors disabled:opacity-50"
        >
          <Download size={16} /> {downloading ? 'Downloading…' : 'Download QR'}
        </button>
      )}
    </motion.div>
  );
}

function UpiPanel({ method, minDepositInr }) {
  const d = method.details || {};
  const upiId = d.upi_id;
  const payee = d.display_name;

  return (
    <motion.div
      key="upi"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-5"
    >
      <PaymentMinNotice minDepositInr={minDepositInr} />
      <div className={INR_INNER_PANEL}>
        <CopyField label="UPI ID" value={upiId} />
        <CopyField label="Merchant name" value={payee} mono={false} />
      </div>
    </motion.div>
  );
}

function BankPanel({ method, minDepositInr }) {
  const d = method.details || {};
  const rows = [
    ['Account name', d.account_holder_name, false],
    ['Account number', d.account_number, true],
    ['IFSC', d.ifsc_code, true],
    ['Bank name', d.bank_name, false],
    ...(d.branch ? [['Branch', d.branch, false]] : []),
  ];

  return (
    <motion.div
      key="bank"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="space-y-4"
    >
      <PaymentMinNotice minDepositInr={minDepositInr} />
      <div className={INR_INNER_PANEL}>
        {rows.map(([label, value]) => (
          <CopyField key={label} label={label} value={value} copyable={!!value} />
        ))}
      </div>
      <div className="flex gap-3 rounded-xl border border-gold/25 bg-gold/10 px-4 py-3 text-sm text-gold-light/90/90">
        <AlertTriangle size={18} className="shrink-0 text-gold mt-0.5" />
        <p>Transfer only from your own bank account. Third-party transfers may be rejected.</p>
      </div>
    </motion.div>
  );
}

export default function PaymentDetailsPanel({
  methods,
  activeType,
  onTypeChange,
  activeMethod,
  onMethodChange,
  collapsed,
  onToggleCollapse,
  showMobileCollapse,
  minDepositInr = 0,
}) {
  const availableTypes = useMemo(
    () => TYPE_ORDER.filter((t) => methods.some((m) => m.type === t)),
    [methods],
  );

  const methodsOfType = useMemo(
    () => methods.filter((m) => m.type === activeType),
    [methods, activeType],
  );

  const header = (
    <div className="flex items-center justify-between gap-3 mb-5">
      <h2 className="text-lg sm:text-xl font-normal text-white">Payment details</h2>
      {showMobileCollapse && (
        <button
          type="button"
          onClick={onToggleCollapse}
          className={`lg:hidden text-xs font-normal ${INR_GOLD} uppercase tracking-wider`}
        >
          {collapsed ? 'Show' : 'Hide'}
        </button>
      )}
    </div>
  );

  const tabs = (
    <div className="flex flex-wrap gap-2 sm:gap-3 mb-6">
      {availableTypes.map((type) => {
        const Meta = TYPE_META[type];
        const Icon = Meta.icon;
        const isActive = activeType === type;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onTypeChange(type)}
            className={`flex items-center gap-2 px-4 sm:px-6 py-3 sm:py-3.5 rounded-[14px] border text-sm sm:text-base font-normal transition-all duration-200 ${
              isActive ? INR_TAB_ACTIVE : INR_TAB_IDLE
            }`}
          >
            <Icon size={20} className={isActive ? 'text-gold-light' : 'text-white/50'} />
            {Meta.tab}
          </button>
        );
      })}
    </div>
  );

  const subPicker = methodsOfType.length > 1 && (
    <div className="flex flex-wrap gap-2 mb-5">
      {methodsOfType.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => onMethodChange(m.id)}
          className={`px-3 py-1.5 rounded-lg text-xs font-normal border transition-colors ${
            activeMethod?.id === m.id
              ? 'border-gold/50 bg-gold/10 text-gold-light'
              : 'border-surface-border text-white/55 hover:border-gold/25'
          }`}
        >
          {methodSelectLabel(m, methods)}
        </button>
      ))}
    </div>
  );

  const body = activeMethod && (
    <AnimatePresence mode="wait">
      {activeMethod.type === 'qr' && (
        <QrPanel method={activeMethod} minDepositInr={minDepositInr} />
      )}
      {activeMethod.type === 'upi' && <UpiPanel method={activeMethod} minDepositInr={minDepositInr} />}
      {activeMethod.type === 'bank' && <BankPanel method={activeMethod} minDepositInr={minDepositInr} />}
    </AnimatePresence>
  );

  return (
    <div className={`${INR_CARD} ${INR_CARD_GLOW} p-6 sm:p-8 lg:p-9 h-full`}>
      {header}
      {tabs}
      <div className={showMobileCollapse && collapsed ? 'hidden lg:block' : ''}>
        {subPicker}
        {body}
      </div>
      {showMobileCollapse && collapsed && (
        <p className="lg:hidden text-sm text-white/45 mt-2">Tap Show to view payment instructions.</p>
      )}
    </div>
  );
}
