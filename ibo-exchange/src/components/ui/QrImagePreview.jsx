import { useEffect, useMemo, useState } from 'react';
import QRCode from 'qrcode';
import QrEnlargeable from '@/components/ui/QrEnlargeable';

const QR_VALUE_MAX = 1800;

function safeQrPayload(raw) {
  let s = String(raw ?? '').replace(/\0/g, '').trim();
  if (!s) return '';
  if (s.length > QR_VALUE_MAX) s = s.slice(0, QR_VALUE_MAX);
  return s;
}

/**
 * Renders a QR as a PNG data URL (avoids react-qr-code SVG crashes on React 19).
 */
export default function QrImagePreview({
  value,
  size = 200,
  modalSize = 400,
  className = '',
  enlarge = true,
  hint = 'Tap to enlarge',
  modalHint = 'Scan with your wallet app',
}) {
  const [dataUrl, setDataUrl] = useState('');
  const [failed, setFailed] = useState(false);
  const safe = useMemo(() => safeQrPayload(value), [value]);

  useEffect(() => {
    if (!safe) {
      setDataUrl('');
      setFailed(false);
      return;
    }
    let cancelled = false;
    setFailed(false);
    QRCode.toDataURL(safe, {
      width: size,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000ff', light: '#ffffffff' },
    })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => {
        if (!cancelled) {
          setDataUrl('');
          setFailed(true);
        }
      });
    return () => { cancelled = true; };
  }, [safe, size]);

  if (!safe) return null;
  if (failed) {
    return (
      <span className={`text-[10px] text-white/50 leading-tight block max-w-[120px] ${className}`}>
        QR unavailable for this payload.
      </span>
    );
  }
  if (!dataUrl) {
    return (
      <div
        className={`rounded bg-white/15 animate-pulse ${className}`}
        style={{ width: size, height: size, minWidth: size, minHeight: size }}
        aria-hidden
      />
    );
  }
  if (enlarge) {
    return (
      <QrEnlargeable
        src={dataUrl}
        alt="Deposit address QR code"
        size={size}
        modalSize={modalSize}
        className={className}
        hint={hint}
        modalHint={modalHint}
      />
    );
  }

  return (
    <img
      src={dataUrl}
      alt="Deposit address QR code"
      width={size}
      height={size}
      className={`block max-w-full rounded ${className}`}
    />
  );
}
