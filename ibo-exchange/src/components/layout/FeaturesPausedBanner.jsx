import { useAuth } from '@/context/AuthContext';
import { PauseCircle, Banknote } from 'lucide-react';

export default function FeaturesPausedBanner() {
  const {
    user,
    userFeaturesPaused,
    userTradingPaused,
    userWithdrawalsPaused,
    userPauseNote,
  } = useAuth();

  if (!user) return null;

  if (userFeaturesPaused || userTradingPaused) {
    return (
      <div
        className="shrink-0 z-[44] border-b border-red-500/35 bg-red-950/50 px-4 py-2.5"
        role="alert"
      >
        <div className="max-w-[1600px] mx-auto flex items-start gap-2 text-sm text-red-100">
          <PauseCircle className="w-5 h-5 shrink-0 text-red-400 mt-0.5" aria-hidden />
          <div className="min-w-0 leading-snug">
            <p className="font-bold text-red-50">
              {userFeaturesPaused ? 'Your account actions are paused' : 'Trading is paused for your account'}
            </p>
            <p className="text-red-200/85 text-xs mt-0.5">
              {userFeaturesPaused
                ? 'Trading, wallet movements, KYC submission, and profile changes are disabled until an administrator restores access.'
                : 'Order placement, close-position actions, and order cancellation are disabled until an administrator restores trading access.'}
            </p>
            {userPauseNote ? (
              <p className="text-red-100/90 text-xs mt-2 border-t border-red-500/20 pt-2">{userPauseNote}</p>
            ) : null}
          </div>
        </div>
      </div>
    );
  }

  if (userWithdrawalsPaused) {
    return (
      <div
        className="shrink-0 z-[44] border-b border-orange-500/35 bg-orange-950/40 px-4 py-2.5"
        role="alert"
      >
        <div className="max-w-[1600px] mx-auto flex items-start gap-2 text-sm text-orange-100">
          <Banknote className="w-5 h-5 shrink-0 text-orange-300 mt-0.5" aria-hidden />
          <div className="min-w-0 leading-snug">
            <p className="font-bold text-orange-50">Withdrawals are paused for your account</p>
            <p className="text-orange-200/85 text-xs mt-0.5">
              You can still trade and deposit. New withdrawal requests are blocked until an administrator restores withdrawal access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return null;
}
