/**
 * In-app DigiLocker authorization — WebView fallback when Custom Tab / Safari VC unavailable.
 * Closes automatically when Signzy redirects to our return bridge, ibo://, or exchange /kyc.
 */
import React, { useCallback, useEffect, useRef } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewNavigation } from 'react-native-webview';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';

function isIboHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h.includes('ibo') || h === 'localhost' || h === '127.0.0.1' || h === '10.0.2.2';
}

export function isDigilockerReturnUrl(url: string): boolean {
  const u = String(url || '').trim();
  if (!u) return false;
  if (u.startsWith('ibo://') && u.includes('digilocker')) return true;
  if (/\/kyc\/digilocker\/return/i.test(u)) return true;
  try {
    const parsed = new URL(u);
    const path = (parsed.pathname || '').replace(/\/+$/, '') || '/';
    const hasRid =
      parsed.searchParams.has('requestId') || parsed.searchParams.has('request_id');
    if (hasRid && (/\/kyc$/i.test(path) || path.endsWith('/kyc'))) return true;
    if (hasRid && /digilocker/i.test(u)) return true;
    // Misconfigured Signzy redirect to the web exchange KYC page — still finish in-app.
    if (isIboHost(parsed.hostname) && /\/kyc$/i.test(path)) return true;
  } catch {
    /* relative or custom scheme */
  }
  return false;
}

export function parseDigilockerReturnUrl(url: string): { requestId?: string; status?: string } {
  const raw = String(url || '');
  const query = raw.includes('?') ? raw.split('?').slice(1).join('?') : '';
  const params = new URLSearchParams(query);
  return {
    requestId: params.get('requestId') || params.get('request_id') || undefined,
    status: params.get('status') || undefined,
  };
}

type Props = {
  visible: boolean;
  url: string;
  onClose: () => void;
  onReturn: (returnUrl: string) => void;
};

export default function DigilockerAuthWebView({ visible, url, onClose, onReturn }: Props) {
  const handledRef = useRef(false);

  useEffect(() => {
    if (visible) handledRef.current = false;
  }, [visible, url]);

  const maybeComplete = useCallback(
    (targetUrl: string) => {
      if (handledRef.current || !isDigilockerReturnUrl(targetUrl)) return;
      handledRef.current = true;
      onReturn(targetUrl);
    },
    [onReturn],
  );

  const onBridgeMessage = useCallback(
    (raw: string) => {
      if (handledRef.current) return;
      try {
        const msg = JSON.parse(raw) as {
          type?: string;
          requestId?: string;
          deep?: string;
        };
        if (msg?.type !== 'digilocker_return') return;
        const deep =
          msg.deep ||
          (msg.requestId
            ? `ibo://kyc/digilocker-complete?requestId=${encodeURIComponent(msg.requestId)}`
            : '');
        if (deep) maybeComplete(deep);
        else if (msg.requestId) {
          maybeComplete(
            `ibo://kyc/digilocker-complete?requestId=${encodeURIComponent(msg.requestId)}`,
          );
        }
      } catch {
        /* ignore */
      }
    },
    [maybeComplete],
  );

  const onNavChange = useCallback(
    (nav: WebViewNavigation) => {
      maybeComplete(nav.url);
    },
    [maybeComplete],
  );

  const interceptUrl = useCallback(
    (targetUrl: string) => {
      if (targetUrl.startsWith('ibo://')) {
        maybeComplete(targetUrl);
        return false;
      }
      if (isDigilockerReturnUrl(targetUrl)) {
        maybeComplete(targetUrl);
        return false;
      }
      return true;
    },
    [maybeComplete],
  );

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={onClose}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>DigiLocker verification</Text>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} accessibilityLabel="Close">
            <Icon name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>
        {url ? (
          <WebView
            key={url}
            source={{ uri: url }}
            style={styles.webview}
            startInLoadingState
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator size="large" color={Colors.goldLight} />
                <Text style={styles.loadingText}>Loading DigiLocker…</Text>
              </View>
            )}
            onNavigationStateChange={onNavChange}
            onLoadEnd={(e) => maybeComplete(e.nativeEvent.url)}
            onMessage={(e) => onBridgeMessage(e.nativeEvent.data)}
            onShouldStartLoadWithRequest={(req) => interceptUrl(req.url)}
            setSupportMultipleWindows={false}
            javaScriptEnabled
            domStorageEnabled
            sharedCookiesEnabled
            thirdPartyCookiesEnabled
          />
        ) : null}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.surfaceDark },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[3],
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: Colors.surfaceBorder,
  },
  title: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  webview: { flex: 1, backgroundColor: Colors.surfaceDark },
  loading: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.surfaceDark,
    gap: Spacing[3],
  },
  loadingText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
  },
});
