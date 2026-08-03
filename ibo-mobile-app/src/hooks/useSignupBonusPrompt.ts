import { useCallback, useEffect, useRef, useState } from 'react';
import { walletApi } from '../api/wallet.api';
import type { SignupBonusPending } from '../types/signupBonus.types';

const POLL_MS = 10_000;
const POLL_MAX = 18;

type OnBonusFound = () => void;

export function useSignupBonusPrompt(onBonusFound?: OnBonusFound) {
  const [prompt, setPrompt] = useState<SignupBonusPending | null>(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shownRef = useRef(false);
  const onBonusFoundRef = useRef(onBonusFound);
  onBonusFoundRef.current = onBonusFound;

  const refresh = useCallback(async () => {
    if (dismissed) return false;
    try {
      const { data } = await walletApi.getSignupBonusPending();
      if (data?.show_prompt) {
        setPrompt(data);
        setVisible(true);
        if (!shownRef.current) {
          shownRef.current = true;
          // Notify consumers (e.g. wallet history tab) to reload their data.
          onBonusFoundRef.current?.();
        }
        return true;
      }
      setPrompt(null);
      setVisible(false);
      return false;
    } catch {
      setPrompt(null);
      setVisible(false);
      return false;
    }
  }, [dismissed]);

  useEffect(() => {
    if (dismissed) return undefined;

    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      if (cancelled || dismissed || shownRef.current) return;
      const ok = await refresh();
      if (ok) shownRef.current = true;
    };

    void tick();
    const id = setInterval(() => {
      attempts += 1;
      if (cancelled || dismissed || shownRef.current || attempts >= POLL_MAX) {
        clearInterval(id);
        return;
      }
      void tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [dismissed, refresh]);

  const dismiss = useCallback(() => {
    setDismissed(true);
    setVisible(false);
  }, []);

  return { prompt, visible, dismiss, refresh };
}
