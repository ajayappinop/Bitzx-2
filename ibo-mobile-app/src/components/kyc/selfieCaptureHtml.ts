/**
 * In-app live selfie capture.
 * The WebView captures the frame AND uploads it directly to /api/kyc/upload
 * via XHR — no data: URI transfer to React Native, no native file I/O needed.
 *
 * Posts back to React Native:
 *   { type: 'ready' }                           — camera live
 *   { type: 'uploading' }                       — frame captured, XHR started
 *   { type: 'upload_complete', selfie_url }     — server saved the selfie
 *   { type: 'upload_error', message }           — XHR or server error
 *   { type: 'camera_error', message }           — getUserMedia failed
 */
export function buildSelfieCaptureHtml(apiUrl: string, token: string): string {
  // Sanitise inputs injected into HTML
  const safeApiUrl = apiUrl.replace(/['"\\]/g, '');
  const safeToken = token.replace(/['"\\]/g, '');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: #0a0b0d; color: #f4f4f5;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
    #root { position: relative; width: 100vw; height: 100vh; display: flex; flex-direction: column; }
    #preview { position: relative; flex: 1; overflow: hidden; background: #000; }
    video { width: 100%; height: 100%; object-fit: cover; transform: scaleX(-1); display: none; }
    video.ready { display: block; }
    #overlay { position: absolute; inset: 0; display: flex; flex-direction: column;
      align-items: center; justify-content: center; pointer-events: none; }
    .oval { width: min(72vw, 280px); aspect-ratio: 3/4; border: 3px solid rgba(197,227,91,0.95);
      border-radius: 50%; box-shadow: 0 0 0 9999px rgba(0,0,0,0.55); }
    #hint { position: absolute; bottom: 24px; left: 16px; right: 16px; text-align: center;
      font-size: 14px; line-height: 1.45; color: rgba(255,255,255,0.88); text-shadow: 0 1px 6px rgba(0,0,0,0.8); }
    #footer { padding: 16px 20px 28px; display: flex; flex-direction: column;
      align-items: center; gap: 12px; background: linear-gradient(180deg,rgba(10,11,13,0.2),#0a0b0d); }
    #captureBtn { width: 72px; height: 72px; border-radius: 36px; border: 4px solid rgba(197,227,91,0.9);
      background: rgba(14,164,171,0.35); color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
    #captureBtn:disabled { opacity: 0.45; cursor: default; }
    #status { min-height: 20px; font-size: 13px; color: #a1a1aa; text-align: center; }
    #status.error { color: #f87171; }
    #loading { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center;
      background: #0a0b0d; font-size: 14px; color: #a1a1aa; flex-direction: column; gap: 12px; }
    .spinner { width: 36px; height: 36px; border: 3px solid rgba(197,227,91,0.3);
      border-top-color: rgba(197,227,91,0.9); border-radius: 50%; animation: spin 0.8s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
  </style>
</head>
<body>
  <div id="root">
    <div id="preview">
      <div id="loading"><div class="spinner"></div><span>Starting front camera…</span></div>
      <video id="video" playsinline autoplay muted></video>
      <div id="overlay">
        <div class="oval"></div>
        <div id="hint">Center your face · good lighting · eyes open</div>
      </div>
    </div>
    <div id="footer">
      <div id="status"></div>
      <button id="captureBtn" type="button" disabled>Capture</button>
    </div>
  </div>
  <script>
    (function () {
      var API_URL = '${safeApiUrl}';
      var TOKEN   = '${safeToken}';
      var UPLOAD_ENDPOINT = API_URL + '/api/kyc/upload';

      var video      = document.getElementById('video');
      var captureBtn = document.getElementById('captureBtn');
      var statusEl   = document.getElementById('status');
      var loadingEl  = document.getElementById('loading');
      var stream     = null;
      var busy       = false;

      function post(payload) {
        try {
          if (window.ReactNativeWebView && window.ReactNativeWebView.postMessage) {
            window.ReactNativeWebView.postMessage(JSON.stringify(payload));
          }
        } catch (e) {}
      }

      function setStatus(msg, isError) {
        statusEl.textContent = msg || '';
        statusEl.className = isError ? 'error' : '';
      }

      function stopStream() {
        if (!stream) return;
        stream.getTracks().forEach(function (t) { t.stop(); });
        stream = null;
      }

      function uploadBlob(blob) {
        setStatus('Uploading selfie…');
        post({ type: 'uploading' });

        var xhr = new XMLHttpRequest();
        xhr.timeout = 90000;
        xhr.open('POST', UPLOAD_ENDPOINT, true);
        xhr.setRequestHeader('Authorization', 'Bearer ' + TOKEN);
        xhr.setRequestHeader('Accept', 'application/json');

        xhr.onload = function () {
          var data = null;
          try { data = JSON.parse(xhr.responseText); } catch (e) {}
          if (xhr.status >= 200 && xhr.status < 300) {
            var selfieUrl = (data && (data.selfie_url || data.document_selfie_url)) || '';
            if (!selfieUrl) {
              setStatus('Upload error: server did not return selfie URL', true);
              post({ type: 'upload_error', message: 'Server did not return selfie URL. Please try again.' });
            } else {
              setStatus('Selfie uploaded — verifying face match…');
              post({ type: 'upload_complete', selfie_url: selfieUrl });
            }
          } else {
            var detail = (data && (data.detail || data.message)) || ('Server error ' + xhr.status);
            setStatus('Upload failed: ' + detail, true);
            post({ type: 'upload_error', message: String(detail) });
          }
        };

        xhr.onerror = function () {
          setStatus('Network error — check connection and retry', true);
          post({ type: 'upload_error', message: 'Network error during selfie upload. Please try again.' });
        };

        xhr.ontimeout = function () {
          setStatus('Upload timed out — please retry', true);
          post({ type: 'upload_error', message: 'Selfie upload timed out. Please try again.' });
        };

        var fd = new FormData();
        fd.append('document_selfie', blob, 'selfie_' + Date.now() + '.jpg');
        xhr.send(fd);
      }

      function captureFrame() {
        if (busy || !stream || !video.videoWidth) return;
        busy = true;
        captureBtn.disabled = true;
        setStatus('Processing…');

        try {
          var maxSide = 1280;
          var vw = video.videoWidth, vh = video.videoHeight;
          var scale = Math.min(1, maxSide / Math.max(vw, vh));
          var cw = Math.round(vw * scale), ch = Math.round(vh * scale);
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          var ctx = canvas.getContext('2d');
          // Mirror horizontally to get correct orientation
          ctx.translate(cw, 0); ctx.scale(-1, 1);
          ctx.drawImage(video, 0, 0, cw, ch);
          stopStream();

          canvas.toBlob(function (blob) {
            if (!blob) {
              busy = false;
              captureBtn.disabled = false;
              setStatus('Capture failed — try again', true);
              post({ type: 'upload_error', message: 'Capture failed. Please try again.' });
              return;
            }
            uploadBlob(blob);
          }, 'image/jpeg', 0.88);
        } catch (e) {
          busy = false;
          captureBtn.disabled = false;
          setStatus('Capture failed — try again', true);
          post({ type: 'upload_error', message: 'Capture failed: ' + (e && e.message ? e.message : String(e)) });
        }
      }

      async function startCamera() {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          loadingEl.querySelector('span').textContent = 'Camera not available';
          post({ type: 'camera_error', message: 'Camera API is not available in this view.' });
          return;
        }
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'user' }, width: { ideal: 1280 }, height: { ideal: 960 } },
          });
          video.srcObject = stream;
          await video.play();
          video.className = 'ready';
          loadingEl.style.display = 'none';
          captureBtn.disabled = false;
          setStatus('Live preview — tap Capture when ready');
          post({ type: 'ready' });
        } catch (err) {
          var msg = (err && err.message) ? err.message : 'Camera permission denied';
          loadingEl.querySelector('span').textContent = 'Could not access camera';
          setStatus(msg, true);
          post({ type: 'camera_error', message: msg });
        }
      }

      captureBtn.addEventListener('click', captureFrame);
      window.addEventListener('beforeunload', stopStream);
      startCamera();
    })();
  </script>
</body>
</html>`;
}
