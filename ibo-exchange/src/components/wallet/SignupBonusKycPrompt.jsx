import { useSignupBonusPrompt } from '@/hooks/useSignupBonusPrompt';
import SignupBonusKycModal from '@/components/wallet/SignupBonusKycModal';

/** Logged-in signup bonus KYC popup (same role as mobile app modal). */
export default function SignupBonusKycPrompt() {
  const { prompt, visible, dismiss } = useSignupBonusPrompt();

  return (
    <SignupBonusKycModal
      visible={visible}
      prompt={prompt}
      onDismiss={dismiss}
    />
  );
}
