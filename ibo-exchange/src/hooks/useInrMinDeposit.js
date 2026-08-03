import { useEffect, useState } from 'react';
import { fetchInrPublicInfo } from '@/services/inrApi';
import { resolveMinDepositInr } from '@/components/inr/deposit/utils';

/** Loads public INR minimum deposit (no login required). */
export function useInrMinDeposit() {
  const [minDepositInr, setMinDepositInr] = useState(0);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const data = await fetchInrPublicInfo();
        if (!cancelled) setMinDepositInr(resolveMinDepositInr(data));
      } catch {
        /* ignore — hide chip when unavailable */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { minDepositInr, loaded };
}
