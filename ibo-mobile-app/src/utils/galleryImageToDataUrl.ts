import type { Asset } from 'react-native-image-picker';

function guessMime(type?: string | null, fileName?: string | null): string {
  const t = (type || '').toLowerCase();
  if (t.includes('png')) return 'image/png';
  if (t.includes('webp')) return 'image/webp';
  if (t.includes('gif')) return 'image/gif';
  if (t.startsWith('image/')) return t;
  const name = (fileName || '').toLowerCase();
  if (name.endsWith('.png')) return 'image/png';
  if (name.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const table = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i];
    const b = i + 1 < bytes.length ? bytes[i + 1] : 0;
    const c = i + 2 < bytes.length ? bytes[i + 2] : 0;
    out += table[a >> 2];
    out += table[((a & 3) << 4) | (b >> 4)];
    out += i + 1 < bytes.length ? table[((b & 15) << 2) | (c >> 6)] : '=';
    out += i + 2 < bytes.length ? table[c & 63] : '=';
  }
  return out;
}

/**
 * Build a data URL from a gallery asset (base64 from picker or fetch(uri) fallback).
 */
export async function assetToImageDataUrl(asset: Asset): Promise<string | null> {
  const mime = guessMime(asset.type, asset.fileName);

  if (asset.base64) {
    const raw = asset.base64.replace(/^data:[^;]+;base64,/, '');
    return raw ? `data:${mime};base64,${raw}` : null;
  }

  const uri = asset.uri?.trim();
  if (!uri) return null;

  try {
    const res = await fetch(uri);
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (!buf.byteLength) return null;
    const headerMime = (res.headers.get('content-type') || '').split(';')[0].trim();
    const resolvedMime = headerMime.startsWith('image/') ? headerMime : mime;
    return `data:${resolvedMime};base64,${arrayBufferToBase64(buf)}`;
  } catch {
    return null;
  }
}
