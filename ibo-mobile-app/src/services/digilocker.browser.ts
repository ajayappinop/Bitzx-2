import { Linking } from 'react-native';
import InAppBrowser from 'react-native-inappbrowser-reborn';
import { Colors } from '../theme';

/** Open DigiLocker in Chrome Custom Tab (Android) or SFSafariViewController (iOS). */
export async function openDigiLockerUrl(url: string): Promise<void> {
  if (await InAppBrowser.isAvailable()) {
    await InAppBrowser.open(url, {
      dismissButtonStyle: 'close',
      preferredBarTintColor: Colors.surfaceDark,
      preferredControlTintColor: Colors.goldLight,
      readerMode: false,
      animated: true,
      modalPresentationStyle: 'fullScreen',
      modalEnabled: true,
      enableBarCollapsing: false,
      showTitle: true,
      toolbarColor: Colors.surfaceDark,
      secondaryToolbarColor: Colors.surfaceCard,
      navigationBarColor: Colors.surfaceDark,
      enableUrlBarHiding: true,
      enableDefaultShare: false,
      // true = Custom Tab automatically closes when it detects a redirect to a
      // URI scheme the app handles (ibo://…).  Without this, the bridge page
      // HTML loads but the tab stays open — the user would have to close it
      // manually before returning to the app.
      forceCloseOnRedirection: true,
      animations: {
        startEnter: 'slide_in_right',
        startExit: 'slide_out_left',
        endEnter: 'slide_in_left',
        endExit: 'slide_out_right',
      },
    });
    return;
  }
  await Linking.openURL(url);
}

export function parseDigiLockerReturnUrl(url: string): { requestId?: string; status?: string } | null {
  if (!url) return null;
  try {
    const normalized = url.includes('://') ? url : `ibo://${url.replace(/^\/+/, '')}`;
    const withoutScheme = normalized.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '');
    const qIndex = withoutScheme.indexOf('?');
    const query = qIndex >= 0 ? withoutScheme.slice(qIndex + 1) : '';
    const params = new URLSearchParams(query);
    const requestId =
      params.get('requestId') ||
      params.get('request_id') ||
      undefined;
    const status = params.get('status') || undefined;
    const path = qIndex >= 0 ? withoutScheme.slice(0, qIndex) : withoutScheme;
    const isKycReturn =
      path.includes('kyc/digilocker-complete') ||
      path.endsWith('/kyc') ||
      path === 'kyc';
    if (!isKycReturn && !requestId) return null;
    return { requestId, status };
  } catch {
    return null;
  }
}
