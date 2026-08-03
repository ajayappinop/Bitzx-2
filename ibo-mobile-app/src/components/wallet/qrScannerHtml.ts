import { JSQR_INLINE_SCRIPT } from './jsqrInline';

const JSQR_TAG = `<script>${JSQR_INLINE_SCRIPT}</script>`;

/** Inline HTML for WebView QR scanner (rear camera). */
export function buildQrScannerHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { width: 100%; height: 100%; background: #000; overflow: hidden; }
  #wrap { position: relative; width: 100%; height: 100%; background: #000; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; background: #111; }
  canvas { display: none; }
  #frame {
    position: absolute; left: 12%; top: 22%; width: 76%; height: 42%;
    border: 2px solid rgba(224,200,120,0.9); border-radius: 16px;
    pointer-events: none; display: none;
  }
  #frame.ready { display: block; }
  #hint {
    position: absolute; bottom: 18%; left: 0; right: 0; text-align: center;
    color: rgba(255,255,255,0.9); font: 14px/1.4 -apple-system, sans-serif;
    padding: 0 24px; display: none;
    text-shadow: 0 1px 4px rgba(0,0,0,0.75);
  }
  #hint.ready { display: block; }
</style>
${JSQR_TAG}
</head>
<body>
<div id="wrap">
  <video id="video" playsinline webkit-playsinline autoplay muted></video>
  <canvas id="canvas"></canvas>
  <div id="frame"></div>
  <div id="hint">Point at a wallet address QR code</div>
</div>
<script>
(function () {
  var done = false;
  var video = document.getElementById('video');
  var canvas = document.getElementById('canvas');
  var frameEl = document.getElementById('frame');
  var hintEl = document.getElementById('hint');
  var stream = null;
  var lastScanAt = 0;

  function post(obj) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    } catch (e) {}
  }

  function fail(message) {
    if (done) return;
    done = true;
    post({ type: 'camera_error', message: message || 'Camera access failed' });
    try {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) {}
  }

  function succeed(data) {
    if (done) return;
    done = true;
    post({ type: 'scan', data: data });
    try {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) {}
  }

  function scanRegion(ctx, sx, sy, sw, sh, dw, dh) {
    if (!sw || !sh) return null;
    canvas.width = dw;
    canvas.height = dh;
    ctx.drawImage(video, sx, sy, sw, sh, 0, 0, dw, dh);
    var pixels = ctx.getImageData(0, 0, dw, dh);
    return jsQR(pixels.data, dw, dh, { inversionAttempts: 'attemptBoth' });
  }

  function scanFrame(ctx) {
    if (typeof jsQR !== 'function') return null;
    var vw = video.videoWidth;
    var vh = video.videoHeight;
    if (!vw || !vh) return null;

    var maxSide = 1024;
    var scale = Math.min(1, maxSide / Math.max(vw, vh));
    var fullW = Math.round(vw * scale);
    var fullH = Math.round(vh * scale);
    var code = scanRegion(ctx, 0, 0, vw, vh, fullW, fullH);
    if (code && code.data) return code;

    var cropX = Math.floor(vw * 0.08);
    var cropY = Math.floor(vh * 0.22);
    var cropW = Math.floor(vw * 0.84);
    var cropH = Math.floor(vh * 0.5);
    var cropScale = Math.min(1, maxSide / Math.max(cropW, cropH));
    var cropDw = Math.round(cropW * cropScale);
    var cropDh = Math.round(cropH * cropScale);
    return scanRegion(ctx, cropX, cropY, cropW, cropH, cropDw, cropDh);
  }

  function scanLoopJsQR() {
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    function tick(now) {
      if (done) return;
      if (video.readyState >= video.HAVE_ENOUGH_DATA && video.videoWidth > 0 && video.videoHeight > 0) {
        if (!lastScanAt || now - lastScanAt >= 80) {
          lastScanAt = now;
          try {
            var code = scanFrame(ctx);
            if (code && code.data) {
              succeed(code.data);
              return;
            }
          } catch (e) {}
        }
      }
      requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);
  }

  async function openStream() {
    var attempts = [
      { audio: false, video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } } },
      { audio: false, video: { facingMode: 'environment' } },
      { audio: false, video: true },
    ];
    var lastErr = null;
    for (var i = 0; i < attempts.length; i++) {
      try {
        return await navigator.mediaDevices.getUserMedia(attempts[i]);
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr || new Error('Camera permission denied');
  }

  function waitForVideo() {
    return new Promise(function (resolve, reject) {
      var settled = false;
      var timer = setTimeout(function () {
        if (settled) return;
        settled = true;
        reject(new Error('Camera preview timed out'));
      }, 8000);

      function done() {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve();
      }

      if (video.readyState >= 2 && video.videoWidth > 0) {
        done();
        return;
      }
      video.onloadedmetadata = function () { done(); };
      video.onloadeddata = function () { done(); };
      video.onplaying = function () { done(); };
    });
  }

  async function startCamera() {
    if (typeof jsQR !== 'function') {
      fail('QR decoder failed to load.');
      return;
    }
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      fail('Camera API is not available.');
      return;
    }
    try {
      stream = await openStream();
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;
      video.playsInline = true;
      video.srcObject = stream;
      try { await video.play(); } catch (e) {}
      await waitForVideo();
      // Force a layout/paint pass — needed on some Android WebViews that stay black.
      video.style.opacity = '0.99';
      requestAnimationFrame(function () {
        video.style.opacity = '1';
      });
      frameEl.className = 'ready';
      hintEl.className = 'ready';
      post({ type: 'ready' });
      scanLoopJsQR();
    } catch (err) {
      fail((err && err.message) ? err.message : 'Camera permission denied');
    }
  }

  window.addEventListener('beforeunload', function () {
    try {
      if (stream) stream.getTracks().forEach(function (t) { t.stop(); });
    } catch (e) {}
  });

  startCamera();
})();
</script>
</body>
</html>`;
}

/** Hidden WebView page — decodes QR codes from gallery images (base64). */
export function buildQrDecodeHtml(): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<style>html,body{margin:0;padding:0;background:#000}</style>
${JSQR_TAG}
</head>
<body>
<canvas id="canvas"></canvas>
<script>
(function () {
  var canvas = document.getElementById('canvas');
  var ctx = canvas.getContext('2d', { willReadFrequently: true });

  function post(obj) {
    try {
      if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
        window.ReactNativeWebView.postMessage(JSON.stringify(obj));
      }
    } catch (e) {}
  }

  function decodeDataUrl(dataUrl) {
    return new Promise(function (resolve, reject) {
      if (typeof jsQR !== 'function') {
        reject('QR decoder not ready');
        return;
      }
      if (!dataUrl || typeof dataUrl !== 'string') {
        reject('Could not read the selected image.');
        return;
      }
      var img = new Image();
      img.onload = function () {
        var w = img.naturalWidth || img.width;
        var h = img.naturalHeight || img.height;
        if (!w || !h) {
          reject('Invalid image');
          return;
        }
        var max = 1600;
        var scale = Math.min(1, max / Math.max(w, h));
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        var pixels = ctx.getImageData(0, 0, canvas.width, canvas.height);
        var code = jsQR(pixels.data, canvas.width, canvas.height, { inversionAttempts: 'attemptBoth' });
        if (code && code.data) resolve(code.data);
        else reject('No QR code found in that image.');
      };
      img.onerror = function () { reject('Could not read the selected image.'); };
      img.src = dataUrl;
    });
  }

  window.__decodeQrImage = function (dataUrl) {
    decodeDataUrl(dataUrl)
      .then(function (data) { post({ type: 'scan', data: data }); })
      .catch(function (err) {
        post({ type: 'decode_error', message: String(err && err.message ? err.message : err) });
      });
  };

  function onRNMessage(event) {
    try {
      var raw = event.data;
      if (typeof raw !== 'string') return;
      var msg = JSON.parse(raw);
      if (msg.type !== 'decode_image') return;
      if (msg.dataUrl) {
        window.__decodeQrImage(msg.dataUrl);
        return;
      }
      if (msg.base64) {
        var mime = msg.mime || 'image/jpeg';
        window.__decodeQrImage('data:' + mime + ';base64,' + msg.base64);
      }
    } catch (e) {}
  }

  document.addEventListener('message', onRNMessage);
  window.addEventListener('message', onRNMessage);

  if (typeof jsQR !== 'function') {
    post({ type: 'decode_error', message: 'QR decoder failed to load.' });
  } else {
    post({ type: 'ready', mode: 'decode' });
  }
})();
</script>
</body>
</html>`;
}
