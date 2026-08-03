import { Link } from 'react-router-dom';
import { Shield, Clock, X, CheckCircle } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';

export default function GetVerifiedModal({ onClose }) {
  const { kyc } = useAuth();
  const pending = kyc?.status === 'pending';
  const rejected = kyc?.status === 'rejected';

  const Icon = pending ? Clock : Shield;
  const iconBg = pending
    ? 'bg-gold/15 border-gold/30'
    : rejected
    ? 'bg-rose-500/15 border-rose-400/30'
    : 'bg-gold/15 border-gold/30';
  const iconColor = pending ? 'text-gold-light' : rejected ? 'text-rose-300' : 'text-gold-light';

  return (
    <div
      className="fixed inset-0 z-[60] bg-black/75 flex items-center justify-center px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md bg-[#0d1018] border border-white/10 rounded-2xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-end mb-2">
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            aria-label="Close"
          >
            <X size={18} />
          </button>
        </div>

        <div className={`mx-auto mb-4 w-14 h-14 rounded-2xl border flex items-center justify-center ${iconBg}`}>
          <Icon size={28} className={iconColor} />
        </div>

        <h2 id="get-verified-title" className="text-xl font-bold text-white text-center mb-2">
          {pending ? 'KYC Under Review' : rejected ? 'KYC Needs Attention' : 'Get Verified'}
        </h2>

        <p className="text-sm text-white/70 text-center mb-6 leading-relaxed">
          {pending
            ? 'Your identity documents are being reviewed. You can check your application status anytime.'
            : rejected
            ? 'Your previous KYC submission was rejected. Please resubmit with clear, valid documents to unlock trading.'
            : 'Complete identity verification to unlock spot trading, deposits, and withdrawals on Delta Exchange.'}
        </p>

        <ul className="space-y-2.5 mb-6">
          {[
            'Trade all spot pairs',
            'Deposit and withdraw funds',
            'Protect your account with verified identity',
          ].map((item) => (
            <li key={item} className="flex items-center gap-2 text-xs text-white/75">
              <CheckCircle size={14} className="text-gold-light shrink-0" />
              {item}
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-2">
          <Link
            to="/kyc"
            onClick={onClose}
            className="w-full py-3 rounded-xl text-center text-sm font-bold bg-gold text-black hover:bg-gold-light transition-colors"
          >
            {pending ? 'Check KYC Status' : rejected ? 'Resubmit KYC' : 'Verify Now'}
          </Link>
          <button
            type="button"
            onClick={onClose}
            className="w-full py-2.5 rounded-xl text-sm text-white/60 hover:text-white/90 transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    </div>
  );
}
