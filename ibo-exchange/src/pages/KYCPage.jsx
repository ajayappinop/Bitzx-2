import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Shield, CheckCircle, Clock, AlertCircle,
  ChevronRight, ChevronLeft, FileText, User,
  Globe, CreditCard, Upload, ImageIcon, ExternalLink, Loader2, Camera,
} from 'lucide-react';
import { useAuth, authFetch } from '@/context/AuthContext';
import { exchangeApiOrigin } from '@/lib/apiBase';
import SuggestionTextField from '@/components/kyc/SuggestionTextField';
import { suggestCountries, suggestCities } from '@/data/kycLocations';
import {
  validateKycPersonal,
  validateKycDocument,
  validateKycFile,
  firstErrorMessage,
  KYC_POSTAL_CATALOG_MAX,
  ENV_POSTAL_MAX_LEN,
  extractPydanticMaxStringLen,
  parseKycSubmit422FieldErrors,
  formatKycSubmit422Banner,
} from '@/lib/kycValidation';

const API = exchangeApiOrigin(import.meta.env.VITE_BACKEND_URL);

const KYC_BENEFITS = [
  { icon: Shield, title: 'Spot trading', desc: 'Unlock all pairs after approval' },
  { icon: CreditCard, title: 'Fiat & crypto rails', desc: 'Deposits and withdrawals' },
  { icon: CheckCircle, title: 'Protected account', desc: 'Identity tied to your profile' },
  { icon: Globe, title: 'Compliance ready', desc: 'Meets exchange requirements' },
];

function StatusBanner({ kyc }) {
  if (!kyc || kyc.status === 'unverified') return null;

  const config = {
    pending: {
      icon: Clock,
      tone: 'warn',
      title: 'Under review',
      msg: 'Documents are being reviewed — usually 1–2 business days.',
    },
    approved: {
      icon: CheckCircle,
      tone: 'ok',
      title: 'Identity verified',
      msg: 'Full trading and withdrawal access is unlocked.',
    },
    rejected: {
      icon: AlertCircle,
      tone: 'err',
      title: 'Application rejected',
      msg: kyc.rejection_reason || 'Resubmit with clear, valid documents.',
    },
    digilocker_failed: {
      icon: AlertCircle,
      tone: 'err',
      title: 'DigiLocker failed',
      msg: kyc.digilocker_failure_reason === 'aadhaar_photo_unavailable'
        ? 'Could not retrieve your Aadhaar photo. Retry DigiLocker or contact support.'
        : kyc.digilocker_failure_reason === 'face_match_not_configured'
          ? 'Face verification is not configured. Contact support.'
          : 'DigiLocker did not complete. You can try again below.',
    },
    digilocker_pending: {
      icon: Clock,
      tone: 'warn',
      title: 'DigiLocker in progress',
      msg: 'Finish authorization in the DigiLocker tab, then check status here.',
    },
    awaiting_pan: {
      icon: CreditCard,
      tone: 'warn',
      title: 'PAN required',
      msg: 'Enter your PAN — verified against Aadhaar name and date of birth.',
    },
    pan_verify_failed: {
      icon: CreditCard,
      tone: 'err',
      title: 'PAN verification failed',
      msg: kyc.pan_verify?.message || 'Check your PAN and try again.',
    },
    awaiting_selfie: {
      icon: Camera,
      tone: 'info',
      title: 'Selfie required',
      msg: 'Capture a clear selfie and run face match to finish.',
    },
    face_match_failed: {
      icon: Camera,
      tone: 'err',
      title: 'Selfie did not match',
      msg: 'Retake with good lighting, facing the camera.',
    },
  };

  const { icon: Icon, tone, title, msg } = config[kyc.status] || config.pending;

  return (
    <div className={`kyc-status kyc-status--${tone}`}>
      <div className="kyc-status__icon" aria-hidden>
        <Icon size={18} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="kyc-status__title">{title}</p>
        <p className="kyc-status__msg">{msg}</p>
        {(kyc.submitted_at || kyc.reviewed_at) && (
          <div className="kyc-status__meta">
            {kyc.submitted_at ? (
              <span>Submitted {new Date(kyc.submitted_at).toLocaleString()}</span>
            ) : null}
            {kyc.reviewed_at ? (
              <span>Reviewed {new Date(kyc.reviewed_at).toLocaleString()}</span>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}

const STEPS = [
  { label: 'Personal', icon: User },
  { label: 'Documents', icon: FileText },
  { label: 'Review', icon: CheckCircle },
];

function buildAutoSteps(panVerifyRequired, faceMatchRequired) {
  const steps = [{ label: 'DigiLocker', icon: Shield }];
  if (panVerifyRequired) steps.push({ label: 'PAN', icon: CreditCard });
  if (faceMatchRequired) steps.push({ label: 'Selfie', icon: Camera });
  return steps;
}

function KycStepBar({ steps, current }) {
  return (
    <ol className="kyc-stepbar" aria-label="Verification steps">
      {steps.map(({ label, icon: Icon }, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li
            key={label}
            className={`kyc-stepbar__item${done ? ' is-done' : ''}${active ? ' is-active' : ''}`}
          >
            <span className="kyc-stepbar__dot">
              {done ? <CheckCircle size={14} strokeWidth={2.25} /> : <Icon size={14} strokeWidth={2.25} />}
            </span>
            <span className="kyc-stepbar__label">{label}</span>
            {i < steps.length - 1 ? <span className="kyc-stepbar__line" aria-hidden /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function normalizePanInput(value) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
}

function isValidPanFormat(pan) {
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(pan);
}

function formatDobDisplay(dob) {
  if (!dob) return '—';
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(dob)) return dob;
  const iso = dob.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return `${iso[3]}/${iso[2]}/${iso[1]}`;
  return dob;
}

function FormInput({ label, required, error, className = '', ...props }) {
  const err = error?.trim();
  return (
    <div className={className}>
      <label className="ibo-field-label !mb-1.5">
        {label}
        {required ? <span className="text-[#F6465D] ml-0.5 normal-case tracking-normal">*</span> : null}
      </label>
      <input
        {...props}
        className={`wallet-field${err ? ' !border-[#F6465D]/50' : ''}`}
      />
      {err ? <p className="text-xs text-[#F6465D] mt-1.5 font-semibold">{err}</p> : null}
    </div>
  );
}

function KycSectionTitle({ icon: Icon, children }) {
  return (
    <div className="kyc-section-title">
      {Icon ? <Icon size={15} className="text-[#FE6C02] shrink-0" /> : null}
      <h3>{children}</h3>
    </div>
  );
}

function KycNotice({ tone = 'neutral', children }) {
  return <div className={`kyc-notice kyc-notice--${tone}`}>{children}</div>;
}

function Step1({ data, onChange, onBlurField, showField, postalMaxLen = KYC_POSTAL_CATALOG_MAX }) {
  const ctrySuggest = useMemo(() => suggestCountries(data.country || ''), [data.country]);
  const citySuggest = useMemo(
    () => suggestCities(data.country || '', data.city || ''),
    [data.country, data.city],
  );

  return (
    <div className="space-y-5">
      <KycSectionTitle icon={User}>Personal information</KycSectionTitle>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
        <FormInput
          className="sm:col-span-2"
          label="Full legal name"
          required
          error={showField('full_name')}
          value={data.full_name || ''}
          placeholder="Exactly as it appears on your ID"
          onChange={(e) => onChange('full_name', e.target.value)}
          onBlur={() => onBlurField('full_name')}
        />
        <FormInput
          label="Date of birth"
          required
          error={showField('date_of_birth')}
          type="date"
          value={data.date_of_birth || ''}
          onChange={(e) => onChange('date_of_birth', e.target.value)}
          onBlur={() => onBlurField('date_of_birth')}
        />
        <FormInput
          label="Nationality"
          required
          error={showField('nationality')}
          value={data.nationality || ''}
          placeholder="e.g. Indian"
          onChange={(e) => onChange('nationality', e.target.value)}
          onBlur={() => onBlurField('nationality')}
        />
        <FormInput
          className="sm:col-span-2"
          label="Street address"
          required
          error={showField('address')}
          value={data.address || ''}
          placeholder="House / flat, street, area"
          onChange={(e) => onChange('address', e.target.value)}
          onBlur={() => onBlurField('address')}
        />
        <SuggestionTextField
          label="Country"
          required
          error={showField('country')}
          value={data.country || ''}
          placeholder="Start typing your country"
          suggestions={ctrySuggest}
          onChange={(v) => onChange('country', v)}
          onBlur={() => onBlurField('country')}
        />
        <SuggestionTextField
          label="City"
          required
          error={showField('city')}
          value={data.city || ''}
          placeholder="Start typing your city"
          suggestions={citySuggest}
          onChange={(v) => onChange('city', v)}
          onBlur={() => onBlurField('city')}
        />
        <div className="sm:col-span-2">
          <FormInput
            label="Postal / ZIP code"
            required
            error={showField('postal_code')}
            value={data.postal_code || ''}
            placeholder="e.g. 560001"
            maxLength={postalMaxLen}
            inputMode="text"
            autoComplete="postal-code"
            onBlur={() => onBlurField('postal_code')}
            onChange={(e) => {
              const v = e.target.value.replace(/[^A-Za-z0-9\s-]/g, '');
              onChange('postal_code', v.slice(0, postalMaxLen));
            }}
          />
          <p className="text-[11px] text-[color:var(--ibo-muted)] mt-1.5">
            Letters, numbers, spaces, and hyphens — max {postalMaxLen} characters.
          </p>
        </div>
      </div>
    </div>
  );
}

const DOC_TYPES = [
  { value: 'passport', label: 'Passport', desc: 'International travel document' },
  { value: 'national_id', label: 'National ID', desc: 'Government-issued identity card' },
  { value: 'driving_license', label: 'Driving licence', desc: 'Valid photo driving licence' },
];

function isImagePath(url) {
  if (!url) return false;
  return /\.(jpe?g|png|webp)$/i.test(url);
}

function UploadSlot({
  label,
  required,
  file,
  remoteUrl,
  onPick,
  error,
  previewAlt,
}) {
  return (
    <div className="min-w-0">
      <p className="ibo-field-label !mb-2">
        {label}
        {required ? <span className="text-[#F6465D] ml-0.5 normal-case tracking-normal">*</span> : null}
      </p>
      <label className="kyc-upload">
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp,application/pdf"
          className="hidden"
          onChange={(e) => {
            onPick(e.target.files?.[0] || null);
            e.target.value = '';
          }}
        />
        <ImageIcon size={20} className="text-[color:var(--ibo-muted)]" />
        <span className="kyc-upload__name">{file ? file.name : 'Choose file'}</span>
        <span className="kyc-upload__hint">JPEG, PNG, WebP, or PDF · max 15MB</span>
      </label>
      {remoteUrl && !file && isImagePath(remoteUrl) ? (
        <img
          src={`${API}${remoteUrl}`}
          alt={previewAlt}
          className="mt-2 rounded-xl max-h-40 object-contain border border-[color:var(--ibo-border-solid)] w-full bg-[color:var(--ibo-bg)]"
        />
      ) : null}
      {remoteUrl && !file && !isImagePath(remoteUrl) ? (
        <a
          href={`${API}${remoteUrl}`}
          target="_blank"
          rel="noreferrer"
          className="text-xs text-[#FE6C02] mt-2 inline-flex items-center gap-1 font-semibold hover:underline"
        >
          View uploaded PDF <ExternalLink size={12} />
        </a>
      ) : null}
      {error ? <p className="text-xs text-[#F6465D] mt-1.5 font-semibold">{error}</p> : null}
    </div>
  );
}

function Step2({
  data,
  onChange,
  docFrontUrl,
  docBackUrl,
  idFrontFile,
  idBackFile,
  onPickFront,
  onPickBack,
  uploading,
  errors = {},
  touched = {},
  revealErrors,
  serverErrors = {},
  onBlurField,
}) {
  const show = (k) => {
    const msg = errors[k];
    if (!msg) return '';
    if (revealErrors || touched[k] || serverErrors[k]) return msg;
    return '';
  };

  return (
    <div className="space-y-6">
      <div>
        <KycSectionTitle icon={FileText}>Document type</KycSectionTitle>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
          {DOC_TYPES.map(({ value, label, desc }) => {
            const selected = data.document_type === value;
            return (
              <button
                key={value}
                type="button"
                onClick={() => onChange('document_type', value)}
                className={`kyc-doc-type${selected ? ' is-selected' : ''}`}
              >
                <p className="kyc-doc-type__label">{label}</p>
                <p className="kyc-doc-type__desc">{desc}</p>
              </button>
            );
          })}
        </div>
        {show('document_type') ? (
          <p className="text-xs text-[#F6465D] mt-2 font-semibold">{show('document_type')}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-5">
        <FormInput
          label="Document number"
          required
          error={show('document_number')}
          value={data.document_number || ''}
          placeholder="As printed on the document"
          onChange={(e) => onChange('document_number', e.target.value)}
          onBlur={() => onBlurField('document_number')}
        />
        <FormInput
          label="Expiry date"
          required
          error={show('document_expiry')}
          type="date"
          value={data.document_expiry || ''}
          onChange={(e) => onChange('document_expiry', e.target.value)}
          onBlur={() => onBlurField('document_expiry')}
        />
      </div>

      <div className="wallet-surface p-4 sm:p-5 space-y-4">
        <div className="flex items-center gap-2">
          <Upload size={16} className="text-[#FE6C02]" />
          <p className="text-sm font-bold text-[color:var(--ibo-ink)]">Document photos</p>
        </div>
        <p className="text-[13px] text-[color:var(--ibo-muted)] leading-relaxed">
          Upload a clear colour photo of your ID. Front is required; back is optional unless your ID has two sides.
        </p>
        <div className="grid sm:grid-cols-2 gap-4">
          <UploadSlot
            label="ID — front"
            required
            file={idFrontFile}
            remoteUrl={docFrontUrl}
            onPick={onPickFront}
            error={show('document_front')}
            previewAlt="ID front"
          />
          <UploadSlot
            label="ID — back"
            file={idBackFile}
            remoteUrl={docBackUrl}
            onPick={onPickBack}
            error={show('document_back')}
            previewAlt="ID back"
          />
        </div>
        {uploading ? (
          <p className="text-xs text-[#FE6C02] flex items-center gap-2 font-semibold">
            <Loader2 size={14} className="animate-spin" /> Uploading…
          </p>
        ) : null}
      </div>
    </div>
  );
}

function Step3({ personal, document: doc, docFrontUrl, docBackUrl }) {
  const Row = ({ label, value }) => (
    <div className="kyc-review-row">
      <span>{label}</span>
      <strong>{value || '—'}</strong>
    </div>
  );

  return (
    <div className="space-y-4">
      <KycSectionTitle icon={CheckCircle}>Review & submit</KycSectionTitle>

      <div className="wallet-surface p-4 sm:p-5">
        <p className="ibo-field-label !mb-3 flex items-center gap-2 !normal-case !tracking-normal">
          <User size={13} className="text-[#FE6C02]" /> Personal
        </p>
        <Row label="Full name" value={personal.full_name} />
        <Row label="Date of birth" value={personal.date_of_birth} />
        <Row label="Nationality" value={personal.nationality} />
        <Row label="Address" value={personal.address} />
        <Row label="City" value={personal.city} />
        <Row label="Country" value={personal.country} />
        <Row label="Postal code" value={personal.postal_code} />
      </div>

      <div className="wallet-surface p-4 sm:p-5">
        <p className="ibo-field-label !mb-3 flex items-center gap-2 !normal-case !tracking-normal">
          <FileText size={13} className="text-[#FE6C02]" /> Document
        </p>
        <Row
          label="Type"
          value={DOC_TYPES.find((d) => d.value === doc.document_type)?.label || doc.document_type}
        />
        <Row label="Number" value={doc.document_number} />
        <Row label="Expiry" value={doc.document_expiry} />
        <Row label="Front upload" value={docFrontUrl ? 'Attached' : '—'} />
        <Row label="Back upload" value={docBackUrl ? 'Attached' : '—'} />
      </div>

      {docFrontUrl && isImagePath(docFrontUrl) ? (
        <div className="wallet-surface p-4">
          <p className="text-[11px] font-semibold text-[color:var(--ibo-muted)] mb-2">ID preview (front)</p>
          <img
            src={`${API}${docFrontUrl}`}
            alt=""
            className="max-h-48 rounded-lg border border-[color:var(--ibo-border-solid)] object-contain"
          />
        </div>
      ) : null}

      <KycNotice tone="warn">
        <span className="font-bold text-[#FE6C02]">Declaration: </span>
        All information is accurate and the documents belong to you. False submissions may result in permanent account suspension.
      </KycNotice>
    </div>
  );
}

function parseApiError(data) {
  const d = data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('; ');
  return d || 'Request failed';
}

function SelfieVerificationPanel({ kyc, onRefresh, onApproved }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);

  const [camState, setCamState] = useState('requesting');
  const [captured, setCaptured] = useState(null);
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startCamera = useCallback(async () => {
    setCamState('requesting');
    setError('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: { ideal: 640 }, height: { ideal: 480 } },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      setCamState('live');
    } catch (err) {
      const denied = err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError';
      setCamState('denied');
      setError(
        denied
          ? 'Camera access was denied. Allow camera access in your browser and try again.'
          : `Could not open camera: ${err.message}`,
      );
    }
  }, []);

  useEffect(() => {
    startCamera();
    return () => stopStream();
  }, [startCamera, stopStream]);

  const takePhoto = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width = video.videoWidth || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob((blob) => {
      if (!blob) return;
      stopStream();
      const url = URL.createObjectURL(blob);
      setCaptured(url);
      setCapturedBlob(blob);
      setCamState('captured');
    }, 'image/jpeg', 0.92);
  }, [stopStream]);

  const retake = useCallback(() => {
    if (captured) {
      URL.revokeObjectURL(captured);
      setCaptured(null);
    }
    setCapturedBlob(null);
    setCamState('requesting');
    startCamera();
  }, [captured, startCamera]);

  const uploadAndVerify = async () => {
    if (!capturedBlob) return;
    setBusy(true);
    setError('');
    try {
      const fd = new FormData();
      fd.append('document_selfie', capturedBlob, 'selfie.jpg');
      const upRes = await authFetch(`${API}/api/kyc/upload`, { method: 'POST', body: fd });
      const upData = await upRes.json();
      if (!upRes.ok) throw new Error(parseApiError(upData));

      const fmRes = await authFetch(`${API}/api/kyc/face-match`, { method: 'POST' });
      const fmData = await fmRes.json();
      if (!fmRes.ok) throw new Error(parseApiError(fmData));

      await onRefresh();
      if (fmData.verified || fmData.kyc_status === 'approved') {
        onApproved?.();
      } else {
        setError(fmData.message || 'Face match failed — retake with better lighting.');
        retake();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const fm = kyc?.face_match;

  return (
    <div className="space-y-4">
      <div className="wallet-surface p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="kyc-panel-icon">
            <Camera size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[color:var(--ibo-ink)]">Selfie verification</p>
            <p className="text-[12px] text-[color:var(--ibo-muted)] mt-0.5">
              Live camera — compared to your Aadhaar photo
            </p>
          </div>
        </div>

        {error ? <KycNotice tone="err">{error}</KycNotice> : null}

        {camState === 'denied' ? (
          <div className="flex flex-col items-center gap-4 py-6 text-center">
            <div className="kyc-panel-icon kyc-panel-icon--err">
              <Camera size={22} />
            </div>
            <p className="text-sm text-[color:var(--ibo-muted)] max-w-xs leading-relaxed">
              Camera access is required for live selfie verification. Allow access, then try again.
            </p>
            <button type="button" onClick={startCamera} className="wallet-action-ghost">
              <Camera size={15} /> Try again
            </button>
          </div>
        ) : null}

        {(camState === 'live' || camState === 'requesting') ? (
          <div className="flex flex-col items-center gap-4">
            <div className="kyc-camera">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
              {camState === 'requesting' ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                  <Loader2 size={28} className="animate-spin text-white/50" />
                </div>
              ) : null}
              {camState === 'live' ? (
                <div className="kyc-camera__guide" aria-hidden>
                  <div className="kyc-camera__oval" />
                </div>
              ) : null}
            </div>
            {camState === 'live' ? (
              <button type="button" onClick={takePhoto} className="wallet-action-primary !px-6 !py-2.5">
                <Camera size={15} /> Take selfie
              </button>
            ) : null}
            <p className="text-[12px] text-[color:var(--ibo-muted)] text-center">
              Centre your face in the oval, then capture.
            </p>
          </div>
        ) : null}

        {camState === 'captured' && captured ? (
          <div className="flex flex-col items-center gap-4">
            <img
              src={captured}
              alt="Selfie preview"
              className="rounded-xl max-h-56 object-cover border border-[color:var(--ibo-border-solid)] w-full max-w-sm"
            />
            <div className="flex flex-wrap gap-2 justify-center">
              <button type="button" onClick={retake} disabled={busy} className="wallet-action-ghost disabled:opacity-50">
                Retake
              </button>
              <button
                type="button"
                onClick={uploadAndVerify}
                disabled={busy}
                className="wallet-action-primary !px-5 disabled:opacity-50"
              >
                {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                {busy ? 'Verifying…' : 'Submit & verify'}
              </button>
            </div>
          </div>
        ) : null}

        <canvas ref={canvasRef} className="hidden" />

        {fm ? (
          <p className={`text-sm font-semibold ${fm.verified ? 'text-[#0ECB81]' : 'text-[#F6465D]'}`}>
            {fm.verified ? 'Face match passed' : 'Face match failed'}
            {fm.match_percentage ? ` — ${fm.match_percentage}` : ''}
          </p>
        ) : null}
      </div>

      <div className="wallet-surface p-4 sm:p-5">
        <p className="ibo-field-label !mb-2">Tips</p>
        <ul className="kyc-tips">
          <li>Use good lighting and face the camera directly.</li>
          <li>Remove hats, masks, and sunglasses.</li>
          <li>Keep your face centred in the oval guide.</li>
        </ul>
      </div>
    </div>
  );
}

function PanVerificationPanel({ kyc, onRefresh, onApproved }) {
  const [pan, setPan] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const personal = kyc?.personal_info || {};
  const pv = kyc?.pan_verify;

  const submitPan = async () => {
    const panNorm = normalizePanInput(pan);
    if (!isValidPanFormat(panNorm)) {
      setError('Enter a valid PAN (e.g. ABCDE1234F).');
      return;
    }
    setBusy(true);
    setError('');
    try {
      const res = await authFetch(`${API}/api/kyc/pan/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pan: panNorm }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(parseApiError(data));
      if (!data.verified) {
        setError(data.message || 'PAN verification failed.');
        await onRefresh?.();
        return;
      }
      await onRefresh?.();
      if (data.kyc_status === 'approved') {
        onApproved?.();
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="wallet-surface p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="kyc-panel-icon">
            <CreditCard size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[color:var(--ibo-ink)]">Verify your PAN</p>
            <p className="text-[12px] text-[color:var(--ibo-muted)] mt-0.5">
              PAN was not found in DigiLocker — verify against Aadhaar details
            </p>
          </div>
        </div>

        <p className="text-[13px] text-[color:var(--ibo-muted)] leading-relaxed">
          We check your PAN with the Income Tax Department using the name and date of birth from your Aadhaar.
        </p>

        <div className="kyc-meta-card">
          <div className="kyc-review-row border-0 py-1.5">
            <span>Name (Aadhaar)</span>
            <strong>{personal.full_name || '—'}</strong>
          </div>
          <div className="kyc-review-row border-0 py-1.5">
            <span>Date of birth</span>
            <strong>{formatDobDisplay(personal.date_of_birth)}</strong>
          </div>
        </div>

        {error ? <KycNotice tone="err">{error}</KycNotice> : null}

        {pv && !pv.verified && kyc?.status === 'pan_verify_failed' && !error ? (
          <KycNotice tone="err">{pv.message || 'Previous PAN verification failed. Try again.'}</KycNotice>
        ) : null}

        <FormInput
          label="PAN number"
          required
          value={pan}
          onChange={(e) => setPan(normalizePanInput(e.target.value))}
          placeholder="ABCDE1234F"
          maxLength={10}
          autoComplete="off"
          className="[&_input]:font-mono [&_input]:tracking-widest [&_input]:uppercase"
        />

        <button
          type="button"
          onClick={submitPan}
          disabled={busy || pan.length < 10}
          className="wallet-action-primary !px-5 !py-2.5 disabled:opacity-50"
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
          {busy ? 'Verifying PAN…' : 'Verify PAN'}
        </button>
      </div>

      <div className="wallet-surface p-4 sm:p-5">
        <p className="ibo-field-label !mb-2">Why PAN?</p>
        <ul className="kyc-tips">
          <li>Required for Indian exchange onboarding.</li>
          <li>Name and DOB must match your Aadhaar exactly.</li>
          <li>Link PAN in DigiLocker next time to skip this step.</li>
        </ul>
      </div>
    </div>
  );
}

function DigiLockerPanel({
  kyc,
  onCheckStatus,
  faceMatchRequired,
  panVerifyRequired,
  syncError,
  onClearSyncError,
}) {
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [digiUrl, setDigiUrl] = useState('');
  const isPending = kyc?.status === 'digilocker_pending';
  const isFailed = kyc?.status === 'digilocker_failed';

  const initDigiLocker = async () => {
    setBusy(true);
    setError('');
    onClearSyncError?.();
    try {
      const res = await authFetch(`${API}/api/kyc/digilocker/init`, { method: 'POST' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || 'Could not start DigiLocker');
      setDigiUrl(data.url);
      window.open(data.url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const checkStatus = async () => {
    if (!onCheckStatus) return;
    setChecking(true);
    try {
      await onCheckStatus();
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="wallet-surface p-5 sm:p-6 space-y-5">
        <div className="flex items-start gap-3">
          <div className="kyc-panel-icon">
            <Shield size={18} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-bold text-[color:var(--ibo-ink)]">Verify with DigiLocker</p>
            <p className="text-[12px] text-[color:var(--ibo-muted)] mt-0.5">
              Instant Aadhaar-based identity verification
            </p>
          </div>
        </div>

        <p className="text-[13px] text-[color:var(--ibo-muted)] leading-relaxed">
          Open DigiLocker, sign in with your Aadhaar-linked account, and grant consent.
          {faceMatchRequired || panVerifyRequired
            ? ` Next you will${panVerifyRequired ? ' verify PAN' : ''}${faceMatchRequired ? `${panVerifyRequired ? ' and' : ''} complete selfie verification` : ' finish verification'}.`
            : ' Your KYC can be approved without uploading documents.'}
        </p>

        {error ? <KycNotice tone="err">{error}</KycNotice> : null}
        {syncError && !error ? <KycNotice tone="err">{syncError}</KycNotice> : null}
        {isPending && !digiUrl && !syncError ? (
          <KycNotice tone="warn">
            Finish DigiLocker in the other tab, return here, then tap <strong>Check status</strong>.
          </KycNotice>
        ) : null}
        {isFailed ? (
          <KycNotice tone="err">Previous DigiLocker attempt failed. Please try again.</KycNotice>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={initDigiLocker}
            disabled={busy}
            className="wallet-action-primary !px-5 !py-2.5 disabled:opacity-50"
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
            {busy ? 'Opening…' : isPending ? 'Re-open DigiLocker' : 'Open DigiLocker'}
          </button>
          {(isPending || isFailed) && (
            <button
              type="button"
              onClick={checkStatus}
              disabled={busy || checking}
              className="wallet-action-ghost disabled:opacity-50"
            >
              {checking ? <Loader2 size={15} className="animate-spin" /> : null}
              Check status
            </button>
          )}
        </div>

        {digiUrl ? (
          <p className="text-[12px] text-[color:var(--ibo-muted)]">
            If the tab did not open,{' '}
            <a href={digiUrl} target="_blank" rel="noopener noreferrer" className="text-[#FE6C02] font-semibold hover:underline">
              open DigiLocker here
            </a>
            .
          </p>
        ) : null}
      </div>

      <div className="wallet-surface p-4 sm:p-5">
        <p className="ibo-field-label !mb-2">How it works</p>
        <ol className="kyc-tips kyc-tips--ordered">
          <li>Open DigiLocker in a new tab.</li>
          <li>Log in with your Aadhaar-linked mobile number.</li>
          <li>Grant consent to share Aadhaar details with Delta.</li>
          <li>
            Return here
            {panVerifyRequired || faceMatchRequired
              ? ` to continue${panVerifyRequired ? ' with PAN' : ''}${faceMatchRequired ? ' and selfie' : ''}.`
              : ' — status updates automatically.'}
          </li>
        </ol>
      </div>
    </div>
  );
}

export default function KYCPage({ accountMode = false } = {}) {
  const navigate = useNavigate();
  const { user, updateUser, fetchKyc: syncAuthKyc } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const goBack = () => {
    if (typeof window !== 'undefined' && window.history.length > 1) {
      navigate(-1);
      return;
    }
    navigate(accountMode ? '/account/profile' : '/');
  };
  const digiReturnHandled = useRef(false);
  const [kyc, setKyc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [kycMode, setKycMode] = useState('manual');
  const [faceMatchRequired, setFaceMatchRequired] = useState(false);
  const [panVerifyRequired, setPanVerifyRequired] = useState(false);
  const [digiSyncError, setDigiSyncError] = useState('');
  const [step, setStep] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const [personal, setPersonal] = useState({
    full_name: user?.name || '',
    date_of_birth: '',
    nationality: '',
    address: '',
    city: '',
    country: '',
    postal_code: '',
  });
  const [docInfo, setDocInfo] = useState({
    document_type: '',
    document_number: '',
    document_expiry: '',
  });
  const [docFrontUrl, setDocFrontUrl] = useState('');
  const [docBackUrl, setDocBackUrl] = useState('');
  const [idFrontFile, setIdFrontFile] = useState(null);
  const [idBackFile, setIdBackFile] = useState(null);
  const [uploadingDocs, setUploadingDocs] = useState(false);
  const [revealPersonalErrors, setRevealPersonalErrors] = useState(false);
  const [revealDocumentErrors, setRevealDocumentErrors] = useState(false);
  const [touchedPersonal, setTouchedPersonal] = useState({});
  const [touchedDoc, setTouchedDoc] = useState({});
  const [serverPersonalErrors, setServerPersonalErrors] = useState({});
  const [serverDocumentErrors, setServerDocumentErrors] = useState({});
  const [postalMaxLearned, setPostalMaxLearned] = useState(null);

  const loadKycStatus = useCallback(() => {
    return authFetch(`${API}/api/kyc/status`)
      .then((r) => r.json())
      .then((data) => {
        setKyc(data);
        if (data.personal_info && typeof data.personal_info === 'object') {
          setPersonal((p) => ({ ...p, ...data.personal_info }));
        }
        if (data.document_info && typeof data.document_info === 'object') {
          setDocInfo((d) => ({ ...d, ...data.document_info }));
        }
        if (data.document_front_url) setDocFrontUrl(data.document_front_url);
        if (data.document_back_url) setDocBackUrl(data.document_back_url);
      })
      .catch(() => {});
  }, []);

  const refreshKyc = useCallback(async () => {
    await loadKycStatus();
    await syncAuthKyc();
  }, [loadKycStatus, syncAuthKyc]);

  useEffect(() => {
    Promise.all([
      loadKycStatus(),
      authFetch(`${API}/api/kyc/mode`)
        .then((r) => r.json())
        .then((d) => {
          setKycMode(d.kyc_mode || 'manual');
          setFaceMatchRequired(!!d.face_match_required);
          setPanVerifyRequired(!!d.pan_verify_required);
        })
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [loadKycStatus]);

  const completeDigiLocker = useCallback(async (requestId) => {
    const res = await authFetch(`${API}/api/kyc/digilocker/complete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(requestId ? { request_id: requestId } : {}),
    });
    const data = await res.json().catch(() => ({}));
    const detail = typeof data.detail === 'string' ? data.detail : data.message;
    if (!res.ok) {
      if (res.status === 503 || (detail && /credit/i.test(detail))) {
        setDigiSyncError(detail || 'Signzy API credits are exhausted. Contact Signzy support.');
      }
      throw new Error(detail || 'Could not sync DigiLocker status');
    }
    setDigiSyncError('');
    return data;
  }, []);

  const handleDigiCheckStatus = useCallback(async () => {
    try {
      await completeDigiLocker();
      await refreshKyc();
    } catch {
      await loadKycStatus();
    }
  }, [completeDigiLocker, refreshKyc, loadKycStatus]);

  useEffect(() => {
    const requestId = searchParams.get('requestId');
    const status = searchParams.get('status');
    if (!requestId && !status) return;
    if (digiReturnHandled.current) return;
    digiReturnHandled.current = true;

    const next = new URLSearchParams(searchParams);
    next.delete('requestId');
    next.delete('status');
    next.delete('scope');
    setSearchParams(next, { replace: true });

    (async () => {
      try {
        await completeDigiLocker(requestId || undefined);
        await refreshKyc();
      } catch {
        await loadKycStatus();
      }
    })();
  }, [searchParams, setSearchParams, refreshKyc, loadKycStatus, completeDigiLocker]);

  const updatePersonal = (k, v) => {
    setServerPersonalErrors({});
    setPersonal((p) => ({ ...p, [k]: v }));
  };
  const updateDoc = (k, v) => {
    setServerDocumentErrors({});
    setDocInfo((d) => ({ ...d, [k]: v }));
  };
  const blurPersonalField = (k) => setTouchedPersonal((t) => ({ ...t, [k]: true }));
  const blurDocField = (k) => setTouchedDoc((t) => ({ ...t, [k]: true }));

  const handlePickFront = (f) => {
    setServerDocumentErrors({});
    setIdFrontFile(f);
    setTouchedDoc((t) => ({ ...t, document_front: true }));
  };
  const handlePickBack = (f) => {
    setServerDocumentErrors({});
    setIdBackFile(f);
    setTouchedDoc((t) => ({ ...t, document_back: true }));
  };

  const hasIdFront = !!(idFrontFile || docFrontUrl);

  const effectivePostalMaxLen = useMemo(() => {
    const fromLearned =
      postalMaxLearned != null && Number.isFinite(postalMaxLearned) ? postalMaxLearned : null;
    const fromEnv = ENV_POSTAL_MAX_LEN;
    const raw = fromLearned ?? fromEnv ?? KYC_POSTAL_CATALOG_MAX;
    return Math.min(KYC_POSTAL_CATALOG_MAX, Math.max(2, raw));
  }, [postalMaxLearned]);

  useEffect(() => {
    setPersonal((p) => {
      const z = String(p.postal_code || '').replace(/[^A-Za-z0-9\s-]/g, '');
      if (z.length <= effectivePostalMaxLen) return p;
      return { ...p, postal_code: z.slice(0, effectivePostalMaxLen) };
    });
  }, [effectivePostalMaxLen]);

  const clientPersonalErrors = useMemo(
    () => validateKycPersonal(personal, { postalMaxLen: effectivePostalMaxLen }),
    [personal, effectivePostalMaxLen],
  );
  const personalErrors = useMemo(
    () => ({ ...serverPersonalErrors, ...clientPersonalErrors }),
    [serverPersonalErrors, clientPersonalErrors],
  );
  const clientDocumentErrors = useMemo(() => {
    const base = validateKycDocument(docInfo, { hasFrontUpload: hasIdFront });
    if (idFrontFile) {
      const fe = validateKycFile(idFrontFile);
      if (fe) base.document_front = fe;
    }
    if (idBackFile) {
      const be = validateKycFile(idBackFile);
      if (be) base.document_back = be;
    }
    return base;
  }, [docInfo, hasIdFront, idFrontFile, idBackFile]);
  const documentErrors = useMemo(
    () => ({ ...serverDocumentErrors, ...clientDocumentErrors }),
    [serverDocumentErrors, clientDocumentErrors],
  );

  const step1Valid =
    Object.keys(clientPersonalErrors).length === 0 && Object.keys(serverPersonalErrors).length === 0;
  const step2Valid =
    Object.keys(clientDocumentErrors).length === 0 && Object.keys(serverDocumentErrors).length === 0;

  const showPersonalField = useCallback(
    (k) => {
      const msg = personalErrors[k];
      if (!msg) return '';
      if (serverPersonalErrors[k] || revealPersonalErrors || touchedPersonal[k]) return msg;
      return '';
    },
    [personalErrors, revealPersonalErrors, touchedPersonal, serverPersonalErrors],
  );

  const parseError = (data) => {
    const d = data?.detail;
    if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('; ');
    return d || 'Request failed';
  };

  const uploadIdFiles = async () => {
    if (!idFrontFile && !idBackFile) return null;
    if (!idFrontFile && !docFrontUrl) {
      throw new Error('Upload the front of your ID first.');
    }
    const fd = new FormData();
    if (idFrontFile) fd.append('document_front', idFrontFile);
    if (idBackFile) fd.append('document_back', idBackFile);
    if (!fd.has('document_front') && !fd.has('document_back')) return null;
    setUploadingDocs(true);
    try {
      const res = await authFetch(`${API}/api/kyc/upload`, { method: 'POST', body: fd });
      const j = await res.json();
      if (!res.ok) throw new Error(parseError(j));
      if (j.document_front_url) setDocFrontUrl(j.document_front_url);
      if (j.document_back_url) setDocBackUrl(j.document_back_url);
      setIdFrontFile(null);
      setIdBackFile(null);
      return j;
    } finally {
      setUploadingDocs(false);
    }
  };

  const handleNext = async () => {
    setError('');
    if (step === 0) {
      setRevealPersonalErrors(true);
      if (!step1Valid) {
        setError(firstErrorMessage(clientPersonalErrors) || 'Please complete all required fields.');
        return;
      }
      setStep(1);
      return;
    }
    if (step === 1) {
      setRevealDocumentErrors(true);
      if (!step2Valid) {
        setError(firstErrorMessage(clientDocumentErrors) || 'Please complete document details and uploads.');
        return;
      }
    }
    let uploadJson = null;
    if (step === 1 && (idFrontFile || idBackFile)) {
      try {
        uploadJson = await uploadIdFiles();
      } catch (e) {
        setError(e.message || 'Upload failed');
        return;
      }
    }
    const frontAfterUpload = uploadJson?.document_front_url || docFrontUrl;
    if (step === 1 && !frontAfterUpload && !idFrontFile) {
      setError('Upload the front of your ID before continuing.');
      return;
    }
    setStep((s) => s + 1);
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError('');
    setServerPersonalErrors({});
    setServerDocumentErrors({});
    try {
      const pe = validateKycPersonal(personal);
      const de = validateKycDocument(docInfo, { hasFrontUpload: !!(idFrontFile || docFrontUrl) });
      if (idFrontFile) {
        const fe = validateKycFile(idFrontFile);
        if (fe) de.document_front = fe;
      }
      if (idBackFile) {
        const be = validateKycFile(idBackFile);
        if (be) de.document_back = be;
      }
      if (Object.keys(pe).length || Object.keys(de).length) {
        setRevealPersonalErrors(true);
        setRevealDocumentErrors(true);
        throw new Error(firstErrorMessage({ ...pe, ...de }) || 'Please fix validation errors.');
      }
      if (!docFrontUrl) {
        throw new Error('Missing document upload. Go back to the document step and upload your ID.');
      }
      const res = await authFetch(`${API}/api/kyc/submit`, {
        method: 'POST',
        body: JSON.stringify({
          personal_info: personal,
          document_info: docInfo,
          document_front_url: docFrontUrl,
          document_back_url: docBackUrl || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (res.status === 422 && Array.isArray(data?.detail)) {
          for (const item of data.detail) {
            const loc = item?.loc;
            if (!Array.isArray(loc)) continue;
            const pi = loc.indexOf('personal_info');
            if (pi >= 0 && loc[pi + 1] === 'postal_code' && item.msg != null) {
              const cap = extractPydanticMaxStringLen(item.msg);
              if (cap != null) setPostalMaxLearned(cap);
              break;
            }
          }
          const { personal: pfe, document: dfe } = parseKycSubmit422FieldErrors(data.detail);
          setServerPersonalErrors(pfe);
          setServerDocumentErrors(dfe);
          setRevealPersonalErrors(true);
          setRevealDocumentErrors(true);
          if (Object.keys(pfe).length) setStep(0);
          else if (Object.keys(dfe).length) setStep(1);
          throw new Error(formatKycSubmit422Banner(data.detail) || parseError(data));
        }
        throw new Error(parseError(data));
      }
      setSubmitted(true);
      setPostalMaxLearned(null);
      setKyc({ status: 'pending', submitted_at: new Date().toISOString() });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const isApproved = kyc?.status === 'approved';
  const isPending = kyc?.status === 'pending';
  const needsForm =
    !submitted &&
    (kyc?.status === 'rejected' ||
      kyc?.status === 'digilocker_failed' ||
      kyc?.status === 'face_match_failed' ||
      !kyc ||
      kyc.status === 'unverified');
  const showForm = needsForm && kycMode === 'manual';
  const showAutoKyc = kycMode === 'auto' && !submitted && !isApproved && !isPending;
  const panAlreadyOnFile = !!(kyc?.pan_info?.linked || kyc?.pan_info?.verified);
  const needPanStep = panVerifyRequired && !panAlreadyOnFile;
  const autoSteps = useMemo(
    () => buildAutoSteps(needPanStep, faceMatchRequired),
    [needPanStep, faceMatchRequired],
  );

  const showDigiLockerStep =
    showAutoKyc && ['digilocker_pending', 'digilocker_failed', 'unverified'].includes(kyc?.status || 'unverified');
  const showPanStep =
    showAutoKyc && needPanStep && ['awaiting_pan', 'pan_verify_failed'].includes(kyc?.status);
  const showSelfieStep =
    showAutoKyc && faceMatchRequired && ['awaiting_selfie', 'face_match_failed'].includes(kyc?.status);

  const autoStepIndex = useMemo(() => {
    if (showSelfieStep) return Math.max(0, autoSteps.length - 1);
    if (showPanStep) return autoSteps.findIndex((s) => s.label === 'PAN');
    return 0;
  }, [showSelfieStep, showPanStep, autoSteps]);

  const showDisabled = kycMode === 'disabled' && !isApproved && !isPending;

  const handleKycApproved = useCallback(() => {
    updateUser({ kyc_status: 'approved' });
  }, [updateUser]);

  if (loading) {
    return (
      <div
        className={
          accountMode
            ? 'flex items-center justify-center py-16'
            : 'ibo-page flex items-center justify-center'
        }
      >
        <div className="w-9 h-9 border-2 border-[#FE6C02] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const progressSteps = kycMode === 'auto' ? autoSteps : STEPS;
  const progressIndex = kycMode === 'auto' ? autoStepIndex : step;

  return (
    <div className={`kyc-hub font-ui ${accountMode ? 'min-w-0' : 'ibo-page'}`}>
      <div className={`kyc-hub__layout ${accountMode ? '' : 'kyc-hub__layout--split'}`}>
        {/* Context rail — standalone /kyc only (hidden in account embed — title is in shell) */}
        {!accountMode ? (
          <aside className="kyc-hub__rail">
            <div className="kyc-hub__rail-mark">
              <Shield size={22} />
            </div>
            <h2 className="kyc-hub__rail-title">
              Identity
              <br />
              verification
            </h2>
            <p className="kyc-hub__rail-lead">
              One-time process. Usually under five minutes. Unlocks trading and withdrawals.
            </p>
            <ul className="kyc-hub__benefits">
              {KYC_BENEFITS.map(({ icon: Icon, title, desc }) => (
                <li key={title}>
                  <span className="kyc-hub__benefit-icon">
                    <Icon size={15} />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <em>{desc}</em>
                  </span>
                </li>
              ))}
            </ul>
            {(showForm || showAutoKyc) && (
              <div className="kyc-hub__rail-steps">
                <p className="ibo-field-label !mb-3">Process</p>
                {progressSteps.map(({ label }, i) => (
                  <div
                    key={label}
                    className={`kyc-hub__rail-step${i === progressIndex ? ' is-active' : ''}${i < progressIndex ? ' is-done' : ''}`}
                  >
                    <span>{i < progressIndex ? '✓' : i + 1}</span>
                    {label}
                  </div>
                ))}
              </div>
            )}
          </aside>
        ) : null}

        <div className="kyc-hub__main">
          <div className="mb-4">
            <button
              type="button"
              onClick={goBack}
              className="wallet-action-ghost text-xs !px-3 !py-2"
            >
              <ChevronLeft size={15} /> Back
            </button>
          </div>

          {!accountMode ? (
            <header className="kyc-hub__head">
              <p className="ibo-field-label !mb-1">Compliance</p>
              <h1 className="kyc-hub__title">KYC verification</h1>
              <p className="kyc-hub__sub">
                Verify your identity to unlock full trading and withdrawal access.
              </p>
            </header>
          ) : null}

          {kyc && kyc.status !== 'unverified' ? (
            <div className="mb-5">
              <StatusBanner kyc={kyc} />
            </div>
          ) : null}

          {submitted ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="wallet-surface p-8 sm:p-10 text-center space-y-4"
            >
              <div className="kyc-panel-icon mx-auto !w-14 !h-14">
                <Clock size={26} />
              </div>
              <h2 className="text-lg sm:text-xl font-bold text-[color:var(--ibo-ink)]">
                Application submitted
              </h2>
              <p className="text-sm text-[color:var(--ibo-muted)] leading-relaxed max-w-md mx-auto">
                Your documents are under review. We will email you once verified — usually within 1–2 business days.
              </p>
            </motion.div>
          ) : null}

          {showDigiLockerStep ? (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              {autoSteps.length > 1 ? <KycStepBar steps={autoSteps} current={autoStepIndex} /> : null}
              <DigiLockerPanel
                kyc={kyc}
                faceMatchRequired={faceMatchRequired}
                panVerifyRequired={needPanStep}
                syncError={digiSyncError}
                onClearSyncError={() => setDigiSyncError('')}
                onCheckStatus={handleDigiCheckStatus}
              />
            </motion.div>
          ) : null}

          {showPanStep ? (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <KycStepBar steps={autoSteps} current={autoStepIndex} />
              <PanVerificationPanel kyc={kyc} onRefresh={refreshKyc} onApproved={handleKycApproved} />
            </motion.div>
          ) : null}

          {showSelfieStep ? (
            <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
              <KycStepBar steps={autoSteps} current={autoStepIndex} />
              <SelfieVerificationPanel kyc={kyc} onRefresh={refreshKyc} onApproved={handleKycApproved} />
            </motion.div>
          ) : null}

          {showDisabled ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="wallet-surface p-8 sm:p-10 text-center space-y-3"
            >
              <div className="kyc-panel-icon kyc-panel-icon--err mx-auto !w-14 !h-14">
                <AlertCircle size={26} />
              </div>
              <p className="text-base font-bold text-[color:var(--ibo-ink)]">
                KYC temporarily unavailable
              </p>
              <p className="text-sm text-[color:var(--ibo-muted)] max-w-sm mx-auto leading-relaxed">
                Identity verification is paused. Check back later or contact support.
              </p>
            </motion.div>
          ) : null}

          {showForm ? (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              className="wallet-surface p-5 sm:p-6 space-y-6"
            >
              <KycStepBar steps={STEPS} current={step} />

              <motion.div
                key={step}
                initial={{ opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.2 }}
              >
                {step === 0 && (
                  <Step1
                    data={personal}
                    onChange={updatePersonal}
                    onBlurField={blurPersonalField}
                    showField={showPersonalField}
                    postalMaxLen={effectivePostalMaxLen}
                  />
                )}
                {step === 1 && (
                  <Step2
                    data={docInfo}
                    onChange={updateDoc}
                    docFrontUrl={docFrontUrl}
                    docBackUrl={docBackUrl}
                    idFrontFile={idFrontFile}
                    idBackFile={idBackFile}
                    onPickFront={handlePickFront}
                    onPickBack={handlePickBack}
                    uploading={uploadingDocs}
                    errors={documentErrors}
                    touched={touchedDoc}
                    revealErrors={revealDocumentErrors}
                    serverErrors={serverDocumentErrors}
                    onBlurField={blurDocField}
                  />
                )}
                {step === 2 && (
                  <Step3
                    personal={personal}
                    document={docInfo}
                    docFrontUrl={docFrontUrl}
                    docBackUrl={docBackUrl}
                  />
                )}
              </motion.div>

              {error ? (
                <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }}>
                  <KycNotice tone="err">
                    <span className="inline-flex items-center gap-2">
                      <AlertCircle size={15} className="shrink-0" /> {error}
                    </span>
                  </KycNotice>
                </motion.div>
              ) : null}

              <div className="flex items-center justify-between gap-3 pt-2 border-t border-[color:var(--ibo-border-solid)]">
                <button
                  type="button"
                  onClick={() => {
                    setError('');
                    setStep((s) => s - 1);
                  }}
                  disabled={step === 0}
                  className="wallet-action-ghost disabled:opacity-0 disabled:pointer-events-none"
                >
                  <ChevronLeft size={16} /> Back
                </button>

                {step < 2 ? (
                  <button
                    type="button"
                    onClick={() => handleNext()}
                    disabled={uploadingDocs}
                    className="wallet-action-primary !px-5 !py-2.5 disabled:opacity-40"
                  >
                    Continue <ChevronRight size={16} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting || !step1Valid || !step2Valid}
                    className="wallet-action-primary !px-5 !py-2.5 disabled:opacity-40"
                  >
                    {submitting ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <CheckCircle size={16} />
                        {kyc?.status === 'rejected' ? 'Resubmit KYC' : 'Submit KYC'}
                      </>
                    )}
                  </button>
                )}
              </div>
            </motion.div>
          ) : null}

          {!submitted && isPending && !showDigiLockerStep && !showPanStep && !showSelfieStep ? (
            <div className="wallet-surface p-8 sm:p-10 text-center space-y-3">
              <div className="kyc-panel-icon mx-auto !w-14 !h-14">
                <Clock size={26} />
              </div>
              <p className="text-base font-bold text-[color:var(--ibo-ink)]">Under review</p>
              <p className="text-sm text-[color:var(--ibo-muted)] max-w-md mx-auto leading-relaxed">
                We are processing your documents. You will get an email when review finishes (1–2 business days).
              </p>
            </div>
          ) : null}

          {isApproved && !submitted ? (
            <div className="wallet-surface p-6 sm:p-8 text-center space-y-3">
              <div className="kyc-panel-icon kyc-panel-icon--ok mx-auto !w-14 !h-14">
                <CheckCircle size={26} />
              </div>
              <p className="text-base font-bold text-[color:var(--ibo-ink)]">You are verified</p>
              <p className="text-sm text-[color:var(--ibo-muted)] max-w-md mx-auto">
                No further action needed. Trade and withdraw with full access.
              </p>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
