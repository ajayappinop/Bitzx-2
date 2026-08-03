import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  PermissionsAndroid,
  StatusBar,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent, WebViewPermissionRequestEvent } from 'react-native-webview';
import { launchImageLibrary } from 'react-native-image-picker';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing, Radius } from '../../theme';
import { buildQrScannerHtml, buildQrDecodeHtml } from './qrScannerHtml';
import { parseWalletAddressFromQr, INVALID_WALLET_QR_MESSAGE } from '../../utils/parseWalletQr';
import { assetToImageDataUrl } from '../../utils/galleryImageToDataUrl';

type Props = {
  visible: boolean;
  onClose: () => void;
  onScan: (address: string) => void;
};

const SCANNER_BASE_URL = 'https://ibo.io';

async function ensureCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CAMERA,
    {
      title: 'Camera permission required',
      message: 'IBO needs your camera to scan wallet address QR codes.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export default function AddressQrScannerModal({ visible, onClose, onScan }: Props) {
  const insets = useSafeAreaInsets();
  const [booting, setBooting] = useState(true);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [error, setError] = useState('');
  const [pickingGallery, setPickingGallery] = useState(false);
  const [webKey, setWebKey] = useState(0);
  const [decodeKey, setDecodeKey] = useState(0);
  const [htmlContent, setHtmlContent] = useState('');
  const [decodeHtml] = useState(() => buildQrDecodeHtml());
  /** Mount decode WebView only when gallery is used — a 2nd WebView breaks camera on many Androids. */
  const [decodeMounted, setDecodeMounted] = useState(false);
  const [decodeReady, setDecodeReady] = useState(false);
  const handledRef = useRef(false);
  const decodeWebRef = useRef<WebView>(null);
  const decodeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingDataUrlRef = useRef<string | null>(null);

  const clearDecodeTimeout = useCallback(() => {
    if (decodeTimeoutRef.current) {
      clearTimeout(decodeTimeoutRef.current);
      decodeTimeoutRef.current = null;
    }
  }, []);

  const reset = useCallback(() => {
    handledRef.current = false;
    setBooting(true);
    setPermissionDenied(false);
    setCameraError('');
    setError('');
    setPickingGallery(false);
    setDecodeMounted(false);
    setDecodeReady(false);
    pendingDataUrlRef.current = null;
    clearDecodeTimeout();
  }, [clearDecodeTimeout]);

  useEffect(() => {
    if (!visible) return;
    reset();
    void (async () => {
      const ok = await ensureCameraPermission();
      if (!ok) {
        setPermissionDenied(true);
        setBooting(false);
        return;
      }
      setHtmlContent(buildQrScannerHtml());
      setWebKey((k) => k + 1);
    })();
  }, [visible, reset]);

  const onPermissionRequest = useCallback((request: WebViewPermissionRequestEvent) => {
    request.nativeEvent.request.grant(request.nativeEvent.resources);
  }, []);

  const applyScanResult = useCallback((raw: string) => {
    if (handledRef.current) return;
    handledRef.current = true;
    const address = parseWalletAddressFromQr(raw);
    if (!address) {
      setError(INVALID_WALLET_QR_MESSAGE);
      handledRef.current = false;
      return;
    }
    onScan(address);
    onClose();
  }, [onClose, onScan]);

  const injectDecode = useCallback((dataUrl: string) => {
    const web = decodeWebRef.current;
    if (!web) return false;
    clearDecodeTimeout();
    decodeTimeoutRef.current = setTimeout(() => {
      setPickingGallery(false);
      setError('Image decode timed out. Try a clearer QR screenshot.');
      decodeTimeoutRef.current = null;
      pendingDataUrlRef.current = null;
    }, 20000);
    web.injectJavaScript(`window.__decodeQrImage(${JSON.stringify(dataUrl)}); true;`);
    return true;
  }, [clearDecodeTimeout]);

  const handleCameraMessage = (event: WebViewMessageEvent) => {
    if (handledRef.current) return;
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        data?: string;
        message?: string;
      };

      if (msg.type === 'ready') {
        setBooting(false);
        return;
      }

      if (msg.type === 'camera_error') {
        setBooting(false);
        setCameraError(msg.message || 'Could not access the camera.');
        return;
      }

      if (msg.type === 'scan' && msg.data) {
        applyScanResult(msg.data);
      } else if (msg.type === 'error') {
        setError(msg.data || 'Camera failed to start.');
      }
    } catch {
      setError('Scanner error. Try again or paste the address manually.');
    }
  };

  const handleDecodeMessage = (event: WebViewMessageEvent) => {
    if (handledRef.current) return;
    try {
      const msg = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        data?: string;
        message?: string;
      };

      if (msg.type === 'ready') {
        setDecodeReady(true);
        const pending = pendingDataUrlRef.current;
        if (pending) {
          pendingDataUrlRef.current = null;
          injectDecode(pending);
        }
        return;
      }

      if (msg.type === 'scan' && msg.data) {
        clearDecodeTimeout();
        setPickingGallery(false);
        pendingDataUrlRef.current = null;
        applyScanResult(msg.data);
        return;
      }

      if (msg.type === 'decode_error') {
        clearDecodeTimeout();
        setPickingGallery(false);
        pendingDataUrlRef.current = null;
        setError(msg.message || 'Could not read a QR code from that image.');
      }
    } catch {
      clearDecodeTimeout();
      setPickingGallery(false);
      pendingDataUrlRef.current = null;
      setError('Could not decode the selected image.');
    }
  };

  const retry = () => {
    reset();
    void (async () => {
      const ok = await ensureCameraPermission();
      if (!ok) {
        setPermissionDenied(true);
        setBooting(false);
        return;
      }
      setHtmlContent(buildQrScannerHtml());
      setWebKey((k) => k + 1);
    })();
  };

  const pickFromGallery = async () => {
    if (pickingGallery || handledRef.current) return;
    setError('');

    const result = await launchImageLibrary({
      mediaType: 'photo',
      selectionLimit: 1,
      includeBase64: true,
      maxWidth: 1400,
      maxHeight: 1400,
      quality: 1,
    });

    if (result.didCancel) return;
    if (result.errorMessage) {
      setError(result.errorMessage);
      return;
    }

    const asset = result.assets?.[0];
    if (!asset?.uri && !asset?.base64) {
      setError('Could not read the selected image. Try another photo.');
      return;
    }

    setPickingGallery(true);

    const dataUrl = await assetToImageDataUrl(asset);
    if (!dataUrl) {
      setPickingGallery(false);
      setError('Could not read the selected image. Try a PNG or JPEG screenshot.');
      return;
    }

    // Mount decode WebView on demand so it never competes with the live camera WebView at open.
    if (!decodeMounted) {
      pendingDataUrlRef.current = dataUrl;
      setDecodeReady(false);
      setDecodeKey((k) => k + 1);
      setDecodeMounted(true);
      return;
    }

    if (decodeReady) {
      injectDecode(dataUrl);
      return;
    }

    pendingDataUrlRef.current = dataUrl;
  };

  const showError = permissionDenied || Boolean(cameraError);
  const topPad = Math.max(insets.top, Platform.OS === 'android' ? (StatusBar.currentHeight ?? 0) : 0) + Spacing[2];
  const bottomPad = Math.max(insets.bottom, Spacing[3]);

  return (
    <Modal
      visible={visible}
      animationType="fade"
      transparent={false}
      statusBarTranslucent={Platform.OS === 'android'}
      presentationStyle={Platform.OS === 'ios' ? 'fullScreen' : undefined}
      onRequestClose={onClose}
    >
      <View style={styles.root}>
        <View style={styles.cameraArea}>
          {showError ? (
            <View style={styles.center}>
              <Icon name="camera-outline" size={40} color={Colors.textMuted} />
              <Text style={styles.errorTitle}>
                {permissionDenied ? 'Camera permission denied' : 'Camera unavailable'}
              </Text>
              <Text style={styles.hint}>
                {permissionDenied
                  ? 'Enable camera access in Settings, or choose a QR image from your gallery below.'
                  : cameraError}
              </Text>
              <TouchableOpacity style={styles.retryBtn} onPress={retry}>
                <Text style={styles.retryText}>Try camera again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <>
              {htmlContent ? (
                <WebView
                  key={webKey}
                  source={{ html: htmlContent, baseUrl: SCANNER_BASE_URL }}
                  style={styles.webview}
                  onMessage={handleCameraMessage}
                  onPermissionRequest={onPermissionRequest}
                  mediaCapturePermissionGrantType="grant"
                  mediaPlaybackRequiresUserAction={false}
                  allowsInlineMediaPlayback
                  javaScriptEnabled
                  domStorageEnabled
                  originWhitelist={['*']}
                  mixedContentMode="always"
                  collapsable={false}
                  onError={() => setCameraError('Camera preview failed to load. Please try again.')}
                />
              ) : null}

              {(booting || !htmlContent) && !pickingGallery ? (
                <View style={styles.overlay} pointerEvents="none">
                  <ActivityIndicator size="large" color={Colors.goldLight} />
                  <Text style={styles.hint}>Starting camera…</Text>
                </View>
              ) : null}

              {pickingGallery ? (
                <View style={styles.overlay}>
                  <ActivityIndicator size="large" color={Colors.goldLight} />
                  <Text style={styles.hint}>Reading QR from image…</Text>
                </View>
              ) : null}
            </>
          )}
        </View>

        <View style={[styles.header, { paddingTop: topPad }]} pointerEvents="box-none">
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Icon name="close" size={22} color={Colors.white} />
          </TouchableOpacity>
          <Text style={styles.title}>Scan wallet address</Text>
          <View style={styles.closeBtn} />
        </View>

        <View style={[styles.footer, { paddingBottom: bottomPad }]} pointerEvents="box-none">
          {error ? (
            <View style={styles.errorBar}>
              <Text style={styles.errorText}>{error}</Text>
              <TouchableOpacity onPress={() => setError('')}>
                <Text style={styles.retryLink}>Dismiss</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          <TouchableOpacity
            style={[styles.galleryBtn, pickingGallery && styles.galleryBtnDisabled]}
            onPress={pickFromGallery}
            disabled={pickingGallery}
            activeOpacity={0.85}
          >
            <Icon name="image-outline" size={20} color={Colors.goldLight} />
            <Text style={styles.galleryBtnText}>
              {pickingGallery ? 'Reading image…' : 'Choose from gallery'}
            </Text>
          </TouchableOpacity>

          <Text style={styles.footerHint}>
            Scan live with the camera or pick a saved QR screenshot.
          </Text>
        </View>

        {decodeMounted ? (
          <View style={styles.hiddenDecodeHost} pointerEvents="none">
            <WebView
              key={decodeKey}
              ref={decodeWebRef}
              source={{ html: decodeHtml, baseUrl: SCANNER_BASE_URL }}
              style={styles.hiddenWebview}
              onMessage={handleDecodeMessage}
              javaScriptEnabled
              domStorageEnabled
              originWhitelist={['*']}
              mixedContentMode="always"
            />
          </View>
        ) : null}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#000',
  },
  cameraArea: {
    flex: 1,
    backgroundColor: '#000',
    overflow: 'hidden',
  },
  webview: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  header: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing[4],
    paddingBottom: Spacing[3],
    backgroundColor: 'transparent',
  },
  closeBtn: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.base,
    color: Colors.white,
    textShadowColor: 'rgba(0,0,0,0.65)',
    textShadowOffset: { width: 0, height: 1 },
    textShadowRadius: 3,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 2,
    paddingHorizontal: Spacing[4],
    paddingTop: Spacing[3],
    gap: Spacing[2],
    backgroundColor: 'rgba(10, 11, 13, 0.92)',
  },
  hiddenDecodeHost: {
    position: 'absolute',
    width: 1,
    height: 1,
    left: -1000,
    top: 0,
    overflow: 'hidden',
    opacity: 0,
  },
  hiddenWebview: {
    width: 1,
    height: 1,
  },
  overlay: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 11, 13, 0.55)',
    gap: Spacing[3],
    zIndex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: Spacing[6],
    gap: Spacing[3],
  },
  hint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorTitle: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
  },
  errorBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: Spacing[3],
    borderRadius: Radius.lg,
    backgroundColor: Colors.dangerDim,
    borderWidth: 1,
    borderColor: 'rgba(239,68,68,0.35)',
    gap: Spacing[2],
  },
  errorText: {
    flex: 1,
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
  },
  retryLink: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  retryBtn: {
    marginTop: Spacing[2],
    paddingHorizontal: Spacing[4],
    paddingVertical: Spacing[2],
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
  },
  retryText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  galleryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: Spacing[2],
    paddingVertical: Spacing[3] + 2,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.gold,
    backgroundColor: Colors.surfaceCard,
  },
  galleryBtnDisabled: {
    opacity: 0.55,
  },
  galleryBtnText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
  footerHint: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.xs,
    color: Colors.textMuted,
    textAlign: 'center',
    lineHeight: 18,
  },
});
