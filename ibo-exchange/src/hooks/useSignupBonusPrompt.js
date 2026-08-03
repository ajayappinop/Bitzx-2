import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch, useAuth } from '@/context/AuthContext';
import { exchangeApiOrigin } from '@/lib/apiBase';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);
const POLL_MS = 10_000;
const POLL_MAX = 18;

function dismissKey(uid) {
  return `ibo_signup_bonus_kyc_dismiss_${uid}`;
}

export function useSignupBonusPrompt() {
  const { user } = useAuth();
  const [prompt, setPrompt] = useState(null);
  const [visible, setVisible] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const shownRef = useRef(false);

  const refresh = useCallback(async () => {
    const uid = user?.uid;
    if (!uid || dismissed) return false;
    try {
      if (sessionStorage.getItem(dismissKey(uid)) === '1') {
        setPrompt(null);
        setVisible(false);
        return false;
      }
      const res = await authFetch(`${API}/api/wallet/signup-bonus-pending`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.show_prompt) {
        setPrompt(null);
        setVisible(false);
        return false;
      }
      setPrompt(data);
      setVisible(true);
      shownRef.current = true;
      return true;
    } catch {
      setPrompt(null);
      setVisible(false);
      return false;
    }
  }, [user?.uid, dismissed]);

  useEffect(() => {
    shownRef.current = false;
    setDismissed(false);
    setPrompt(null);
    setVisible(false);
  }, [user?.uid]);

  useEffect(() => {
    if (!user?.uid || dismissed) return undefined;

    let cancelled = false;
    let attempts = 0;

    const tick = async () => {
      if (cancelled || dismissed || shownRef.current) return;
      const ok = await refresh();
      if (ok) shownRef.current = true;
    };

    void tick();
    const id = window.setInterval(() => {
      attempts += 1;
      if (cancelled || dismissed || shownRef.current || attempts >= POLL_MAX) {
        window.clearInterval(id);
        return;
      }
      void tick();
    }, POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [user?.uid, dismissed, refresh]);

  const dismiss = useCallback(() => {
    if (user?.uid) {
      sessionStorage.setItem(dismissKey(user.uid), '1');
    }
    setDismissed(true);
    setVisible(false);
  }, [user?.uid]);

  return { prompt, visible, dismiss, refresh };
}
