/**
 * In-app live selfie capture.
 * Uses a WebView with getUserMedia — no system camera hand-off (which crashes on some Android builds).
 * The WebView captures the frame AND uploads it directly to /api/kyc/upload via XHR.
 * No react-native-blob-util or file I/O needed.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Modal,
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  SafeAreaView,
  Platform,
  PermissionsAndroid,
} from 'react-native';
import { WebView } from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview';
import Icon from '@/components/common/AppIcon';
import { Colors, FontFamily, FontSize, Spacing } from '../../theme';
import { API_URL } from '../../config/env';
import { STORAGE_KEYS } from '../../config/storageKeys';
import StorageService from '../../services/storage.service';
import { buildSelfieCaptureHtml } from './selfieCaptureHtml';

type Props = {
  visible: boolean;
  onClose: () => void;
  /** Called when selfie was captured and uploaded successfully. */
  onUploadComplete: (selfieUrl: string) => void;
  /** Called when camera or upload fails — modal stays open so user can retry. */
  onUploadError: (message: string) => void;
};

async function ensureCameraPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true;
  const granted = await PermissionsAndroid.request(
    PermissionsAndroid.PERMISSIONS.CAMERA,
    {
      title: 'Camera permission required',
      message: 'IBO needs your camera for a live selfie during identity verification.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    },
  );
  return granted === PermissionsAndroid.RESULTS.GRANTED;
}

export default function SelfieCaptureModal({ visible, onClose, onUploadComplete, onUploadError }: Props) {
  const [booting, setBooting] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [uploadError, setUploadError] = useState('');
  const [webKey, setWebKey] = useState(0);
  const [htmlContent, setHtmlContent] = useState('');
  const handledRef = useRef(false);

  const reset = useCallback(() => {
    handledRef.current = false;
    setBooting(true);
    setUploading(false);
    setPermissionDenied(false);
    setCameraError('');
    setUploadError('');
  }, []);

  useEffect(() => {
    if (!visible) return;
    reset();
    void (async () => {
      // Request permission first
      const ok = await ensureCameraPermission();
      if (!ok) {
        setPermissionDenied(true);
        setBooting(false);
        return;
      }
      // Load auth token then build HTML
      const token = (await StorageService.get(STORAGE_KEYS.TOKEN)) ?? '';
      const html = buildSelfieCaptureHtml(API_URL, token);
      setHtmlContent(html);
      setWebKey((k) => k + 1);
    })();
  }, [visible, reset]);

  const handleClose = useCallback(() => {
    reset();
    onClose();
  }, [onClose, reset]);

  const retryCapture = useCallback(() => {
    reset();
    void (async () => {
      const token = (await StorageService.get(STORAGE_KEYS.TOKEN)) ?? '';
      const html = buildSelfieCaptureHtml(API_URL, token);
      setHtmlContent(html);
      setWebKey((k) => k + 1);
    })();
  }, [reset]);

  const onMessage = useCallback(
    (event: WebViewMessageEvent) => {
      try {
        const data = JSON.parse(event.nativeEvent.data) as {
          type?: string;
          selfie_url?: string;
          message?: string;
        };

        if (data.type === 'ready') {
          setBooting(false);
          return;
        }

        if (data.type === 'uploading') {
          setUploading(true);
          return;
        }

        if (data.type === 'camera_error') {
          setBooting(false);
          setCameraError(data.message || 'Could not access the camera.');
          return;
        }

        if (data.type === 'upload_error') {
          if (handledRef.current) return;
          setUploading(false);
          const msg = data.message || 'Selfie upload failed. Please try again.';
          setUploadError(msg);
          onUploadError(msg);
          return;
        }

        if (data.type === 'upload_complete' && data.selfie_url) {
          if (handledRef.current) return;
          handledRef.current = true;
          setUploading(false);
          onUploadComplete(data.selfie_url);
        }
      } catch {
        /* ignore malformed messages */
      }
    },
    [onUploadComplete, onUploadError],
  );

  const onPermissionRequest = useCallback(
    (request: { nativeEvent: { request: { grant: (r: string[]) => void }; resources: string[] } }) => {
      request.nativeEvent.request.grant(request.nativeEvent.resources);
    },
    [],
  );

  const showError = permissionDenied || cameraError || uploadError;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClose}
    >
      <SafeAreaView style={styles.safe}>
        <View style={styles.header}>
          <Text style={styles.title}>Live selfie</Text>
          <TouchableOpacity onPress={handleClose} style={styles.closeBtn} accessibilityLabel="Close">
            <Icon name="close" size={22} color={Colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {showError ? (
          <View style={styles.centered}>
            <Icon name="camera-enhance-outline" size={40} color={Colors.danger} />
            <Text style={styles.errorTitle}>
              {permissionDenied ? 'Camera permission denied' : 'Camera error'}
            </Text>
            <Text style={styles.errorBody}>
              {permissionDenied
                ? 'Enable camera access in Settings → Apps → IBO → Permissions, then try again.'
                : cameraError || uploadError}
            </Text>
            {!permissionDenied && (
              <TouchableOpacity onPress={retryCapture} style={styles.retryBtn}>
                <Icon name="refresh" size={16} color={Colors.goldLight} />
                <Text style={styles.retryText}>Try again</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <>
            {htmlContent ? (
              <WebView
                key={webKey}
                source={{ html: htmlContent, baseUrl: 'https://ibo.io' }}
                style={styles.webview}
                originWhitelist={['*']}
                javaScriptEnabled
                domStorageEnabled
                allowsInlineMediaPlayback
                mediaPlaybackRequiresUserAction={false}
                mediaCapturePermissionGrantType="grant"
                onPermissionRequest={onPermissionRequest}
                onMessage={onMessage}
                onError={() => setCameraError('Camera preview failed to load. Please try again.')}
              />
            ) : null}

            {(booting || uploading) && (
              <View style={styles.overlay} pointerEvents="none">
                <ActivityIndicator size="large" color={Colors.goldLight} />
                <Text style={styles.overlayText}>
                  {uploading ? 'Uploading selfie to server…' : 'Starting front camera…'}
                </Text>
              </View>
            )}
          </>
        )}
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
  webview: { flex: 1, backgroundColor: '#000' },
  overlay: {
    ...StyleSheet.absoluteFill,
    top: 56,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(10, 11, 13, 0.72)',
    gap: Spacing[3],
    paddingHorizontal: Spacing[6],
  },
  overlayText: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: Spacing[6],
    gap: Spacing[3],
  },
  errorTitle: {
    fontFamily: FontFamily.bold,
    fontSize: FontSize.lg,
    color: Colors.textPrimary,
    textAlign: 'center',
  },
  errorBody: {
    fontFamily: FontFamily.regular,
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 21,
  },
  retryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing[2],
    paddingHorizontal: Spacing[5],
    paddingVertical: Spacing[3],
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.goldAlpha30,
    backgroundColor: Colors.goldAlpha10,
    marginTop: Spacing[2],
  },
  retryText: {
    fontFamily: FontFamily.semiBold,
    fontSize: FontSize.sm,
    color: Colors.goldLight,
  },
});
