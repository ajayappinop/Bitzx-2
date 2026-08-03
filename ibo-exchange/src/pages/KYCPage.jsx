import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';
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

// ─── Why KYC info panel ───────────────────────────────────────────────────────
const KYC_BENEFITS = [
  { icon: Shield,      color: '#22c55e', title: 'Secure Trading',        desc: 'Fully unlock spot trading for all pairs' },
  { icon: CreditCard,  color: '#60a5fa', title: 'Deposits & Withdrawals', desc: 'Manual deposit and withdrawal access' },
  { icon: CheckCircle, color: '#C5E35B', title: 'Account Protection',    desc: 'Identity verified, funds stay safe' },
  { icon: Globe,       color: '#0EA4AB', title: 'Regulatory Compliance', desc: 'Meet global exchange requirements' },
];

// ─── Status banner ────────────────────────────────────────────────────────────
function StatusBanner({ kyc }) {
  if (!kyc || kyc.status === 'unverified') return null;

  const config = {
    pending:  { icon: Clock,       color: '#0EA4AB', bg: 'rgba(14,164,171,0.08)',  border: 'rgba(14,164,171,0.25)',
                title: 'Application Under Review',
                msg: 'Your identity documents are being reviewed. This usually takes 1–2 business days.' },
    approved: { icon: CheckCircle, color: '#22c55e', bg: 'rgba(34,197,94,0.08)',   border: 'rgba(34,197,94,0.25)',
                title: 'Identity Verified',
                msg: 'Your identity has been verified. You have full trading and withdrawal access.' },
    rejected: { icon: AlertCircle, color: '#ef4444', bg: 'rgba(239,68,68,0.08)',   border: 'rgba(239,68,68,0.25)',
                title: 'KYC Application Rejected',
                msg: kyc.rejection_reason || 'Your documents were rejected. Please resubmit with valid, clear documents.' },
    digilocker_failed: { icon: AlertCircle, color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)',
                title: 'DigiLocker verification failed',
                msg: kyc.digilocker_failure_reason === 'aadhaar_photo_unavailable'
                  ? 'We could not retrieve your Aadhaar photo. Please try DigiLocker again or contact support.'
                  : kyc.digilocker_failure_reason === 'face_match_not_configured'
                  ? 'Face verification is not configured on this platform. Please contact support.'
                  : 'DigiLocker did not complete. You can try again below.' },
    digilocker_pending: { icon: Clock, color: '#0EA4AB', bg: 'rgba(14,164,171,0.08)', border: 'rgba(14,164,171,0.25)',
                title: 'DigiLocker in progress',
                msg: 'Finish authorization in the DigiLocker tab. This page updates when step 1 is complete.' },
    awaiting_pan: { icon: CreditCard, color: '#0EA4AB', bg: 'rgba(14,164,171,0.08)', border: 'rgba(14,164,171,0.25)',
                title: 'Step 2 — PAN verification',
                msg: 'PAN was not linked in DigiLocker. Enter your PAN — we verify it against your Aadhaar name and date of birth.' },
    pan_verify_failed: { icon: CreditCard, color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)',
                title: 'PAN verification failed',
                msg: kyc.pan_verify?.message || 'Check your PAN number and try again. It must match the name and DOB on your Aadhaar.' },
    awaiting_selfie: { icon: Camera, color: '#60a5fa', bg: 'rgba(96,165,250,0.08)', border: 'rgba(96,165,250,0.25)',
                title: 'Selfie verification',
                msg: 'Upload a clear selfie and run face match to finish verification.' },
    face_match_failed: { icon: Camera, color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)',
                title: 'Selfie did not match',
                msg: 'Upload a well-lit selfie facing the camera, then run face match again.' },
  };

  const { icon: Icon, color, bg, border, title, msg } = config[kyc.status] || config.pending;

  return (
    <div className="rounded-2xl p-6 flex gap-5" style={{ background: bg, border: `1px solid ${border}` }}>
      <div className="w-12 h-12 rounded-2xl flex items-center justify-center flex-shrink-0"
        style={{ background: `${color}20`, border: `1px solid ${color}30` }}>
        <Icon size={22} style={{ color }} />
      </div>
      <div>
        <p className="text-lg font-extrabold mb-1.5" style={{ color }}>{title}</p>
        <p className="text-base text-ink-secondary leading-relaxed">{msg}</p>
        <div className="flex flex-wrap gap-4 mt-3">
          {kyc.submitted_at && (
            <p className="text-sm text-ink-muted">
              Submitted: <span className="text-ink">{new Date(kyc.submitted_at).toLocaleString()}</span>
            </p>
          )}
          {kyc.reviewed_at && (
            <p className="text-sm text-ink-muted">
              Reviewed: <span className="text-ink">{new Date(kyc.reviewed_at).toLocaleString()}</span>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Step indicator ───────────────────────────────────────────────────────────
const STEPS = [
  { label: 'Personal Info',     icon: User },
  { label: 'Document Details',  icon: FileText },
  { label: 'Review & Submit',   icon: CheckCircle },
];

function buildAutoSteps(panVerifyRequired, faceMatchRequired) {
  const steps = [{ label: 'DigiLocker', icon: Shield }];
  if (panVerifyRequired) steps.push({ label: 'PAN', icon: CreditCard });
  if (faceMatchRequired) steps.push({ label: 'Selfie', icon: Camera });
  return steps;
}

function AutoStepIndicator({ steps, current }) {
  return (
    <div className="flex items-center mb-8 overflow-x-auto scrollbar-hide">
      {steps.map(({ label, icon: Icon }, i) => (
        <div key={label} className="flex items-center flex-1 last:flex-none min-w-[80px]">
          <div className="flex flex-col items-center">
            <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-bold transition-all ${
              i < current ? 'bg-green-500 text-white' : i === current ? 'text-surface-dark' : 'text-white'
            }`}
              style={i === current ? { background: 'linear-gradient(135deg, #0EA4AB, #C5E35B)' } : {}}>
              {i < current ? <CheckCircle size={16} /> : <Icon size={16} />}
            </div>
            <span className={`mt-1.5 text-[10px] sm:text-xs font-bold text-center ${
              i === current ? 'text-gold-light' : i < current ? 'text-green-400' : 'text-white'}`}>
              {label}
            </span>
          </div>
          {i < steps.length - 1 && (
            <div className="flex-1 h-0.5 mx-2 sm:mx-4 mb-5 rounded-full transition-all"
              style={{ background: i < current ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.07)' }} />
          )}
        </div>
      ))}
    </div>
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

function StepIndicator({ current }) {
  return (
    <div className="flex items-center mb-8 overflow-x-auto scrollbar-hide">
      {STEPS.map(({ label, icon: Icon }, i) => (
        <div key={i} className="flex items-center flex-1 last:flex-none min-w-[60px]">
          <div className="flex flex-col items-center">
            <div className={`w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-bold
              transition-all ${i < current  ? 'bg-green-500 text-white'
                             : i === current ? 'text-surface-dark'
                                             : 'text-white'}`}
              style={i === current ? { background: 'linear-gradient(135deg, #0EA4AB, #C5E35B)' } : {}}>
              {i < current ? <CheckCircle size={16} /> : <Icon size={16} />}
            </div>
            <span className={`mt-1.5 text-[10px] sm:text-xs font-bold text-center ${
              i === current ? 'text-gold-light' : i < current ? 'text-green-400' : 'text-white'}`}>
              {label}
            </span>
          </div>
          {i < STEPS.length - 1 && (
            <div className="flex-1 h-0.5 mx-2 sm:mx-4 mb-5 rounded-full transition-all"
              style={{ background: i < current ? 'rgba(34,197,94,0.5)' : 'rgba(255,255,255,0.07)' }} />
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Form Input ───────────────────────────────────────────────────────────────
function FormInput({ label, required, error, ...props }) {
  const err = error?.trim();
  return (
    <div>
      <label className="ibo-field-label !normal-case !tracking-wide !text-xs !font-semibold text-ink">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      <input
        {...props}
        className={`ibo-input !py-3.5 text-base ${err ? '!border-red-500/50' : ''}`}
      />
      {err && <p className="text-xs text-red-400 mt-1.5 font-semibold">{err}</p>}
    </div>
  );
}

// ─── Step 1: Personal Info ────────────────────────────────────────────────────
function Step1({ data, onChange, onBlurField, showField, postalMaxLen = KYC_POSTAL_CATALOG_MAX }) {
  const ctrySuggest = useMemo(() => suggestCountries(data.country || ''), [data.country]);
  const citySuggest = useMemo(
    () => suggestCities(data.country || '', data.city || ''),
    [data.country, data.city],
  );

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
      <div className="sm:col-span-2">
        <FormInput label="Full Legal Name" required error={showField('full_name')} value={data.full_name || ''} placeholder="Exactly as it appears on your ID"
          onChange={e => onChange('full_name', e.target.value)} onBlur={() => onBlurField('full_name')} />
      </div>
      <FormInput label="Date of Birth" required error={showField('date_of_birth')} type="date" value={data.date_of_birth || ''}
        onChange={e => onChange('date_of_birth', e.target.value)} onBlur={() => onBlurField('date_of_birth')} />
      <FormInput label="Nationality" required error={showField('nationality')} value={data.nationality || ''} placeholder="e.g. Indian, British, American"
        onChange={e => onChange('nationality', e.target.value)} onBlur={() => onBlurField('nationality')} />
      <div className="sm:col-span-2">
        <FormInput label="Street Address" required error={showField('address')} value={data.address || ''} placeholder="House / flat, street, area, landmark"
          onChange={e => onChange('address', e.target.value)} onBlur={() => onBlurField('address')} />
      </div>
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
          label="Postal / ZIP Code"
          required
          error={showField('postal_code')}
          value={data.postal_code || ''}
          placeholder="e.g. 10001, SW1A 1AA, 560001"
          maxLength={postalMaxLen}
          inputMode="text"
          autoComplete="postal-code"
          onBlur={() => onBlurField('postal_code')}
          onChange={(e) => {
            const v = e.target.value.replace(/[^A-Za-z0-9\s-]/g, '');
            onChange('postal_code', v.slice(0, postalMaxLen));
          }}
        />
        <p className="text-[10px] text-white/45 mt-1.5">
          Letters, numbers, spaces, and hyphens only — max {postalMaxLen} characters.
        </p>
      </div>
    </div>
  );
}

// ─── Step 2: Document Info ────────────────────────────────────────────────────
const DOC_TYPES = [
  { value: 'passport',        label: 'Passport',        emoji: '🛂', desc: 'International travel document' },
  { value: 'national_id',     label: 'National ID',     emoji: '🪪', desc: 'Government-issued identity card' },
  { value: 'driving_license', label: 'Driving License', emoji: '🚗', desc: 'Valid driving license with photo' },
];

function isImagePath(url) {
  if (!url) return false;
  return /\.(jpe?g|png|webp)$/i.test(url);
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
        <label className="block text-sm font-semibold text-white mb-3">
          Document Type <span className="text-red-400">*</span>
        </label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 sm:gap-4">
          {DOC_TYPES.map(({ value, label, emoji, desc }) => (
            <button key={value} type="button" onClick={() => onChange('document_type', value)}
              className="py-4 px-4 rounded-2xl text-left transition-all"
              style={data.document_type === value
                ? { background: 'rgba(14,164,171,0.12)', border: '1px solid rgba(14,164,171,0.4)' }
                : { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <div className="text-2xl mb-2">{emoji}</div>
              <p className={`text-sm font-bold ${data.document_type === value ? 'text-gold-light' : 'text-white'}`}>{label}</p>
              <p className="text-xs text-white mt-1">{desc}</p>
            </button>
          ))}
        </div>
        {show('document_type') ? (
          <p className="text-xs text-red-400 mt-2 font-semibold">{show('document_type')}</p>
        ) : null}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
        <FormInput label="Document Number" required error={show('document_number')} value={data.document_number || ''}
          placeholder="As printed on the document"
          onChange={e => onChange('document_number', e.target.value)}
          onBlur={() => onBlurField('document_number')}
        />
        <FormInput label="Expiry Date" required error={show('document_expiry')} type="date" value={data.document_expiry || ''}
          onChange={e => onChange('document_expiry', e.target.value)}
          onBlur={() => onBlurField('document_expiry')}
        />
      </div>

      <div className="rounded-2xl p-5 space-y-4"
        style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)' }}>
        <div className="flex items-center gap-2 text-white font-bold">
          <Upload size={18} className="text-blue-400" />
          Document photos
        </div>
        <p className="text-sm text-white/80 leading-relaxed">
          Upload a <strong className="text-white">clear, color photo</strong> of your ID (JPEG, PNG, WebP, or PDF). Max 15MB per file.
          Front is required; back is optional unless your ID has two sides.
        </p>

        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-bold text-white/70 mb-2">ID — front <span className="text-red-400">*</span></label>
            <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-black/20 px-4 py-6 cursor-pointer hover:border-gold/40 transition-colors">
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                onChange={(e) => { onPickFront(e.target.files?.[0] || null); e.target.value = ''; }} />
              <ImageIcon size={22} className="text-white/50" />
              <span className="text-xs text-white/70 text-center">{idFrontFile ? idFrontFile.name : 'Choose file'}</span>
            </label>
            {(docFrontUrl && !idFrontFile && isImagePath(docFrontUrl)) && (
              <img src={`${API}${docFrontUrl}`} alt="ID front" className="mt-2 rounded-lg max-h-40 object-contain border border-white/10" />
            )}
            {docFrontUrl && !idFrontFile && !isImagePath(docFrontUrl) && (
              <a href={`${API}${docFrontUrl}`} target="_blank" rel="noreferrer" className="text-xs text-blue-400 mt-2 inline-block">View uploaded PDF</a>
            )}
            {show('document_front') ? (
              <p className="text-xs text-red-400 mt-1.5 font-semibold">{show('document_front')}</p>
            ) : null}
          </div>
          <div>
            <label className="block text-xs font-bold text-white/70 mb-2">ID — back (optional)</label>
            <label className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/20 bg-black/20 px-4 py-6 cursor-pointer hover:border-gold/40 transition-colors">
              <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                onChange={(e) => { onPickBack(e.target.files?.[0] || null); e.target.value = ''; }} />
              <ImageIcon size={22} className="text-white/50" />
              <span className="text-xs text-white/70 text-center">{idBackFile ? idBackFile.name : 'Choose file'}</span>
            </label>
            {(docBackUrl && !idBackFile && isImagePath(docBackUrl)) && (
              <img src={`${API}${docBackUrl}`} alt="ID back" className="mt-2 rounded-lg max-h-40 object-contain border border-white/10" />
            )}
            {docBackUrl && !idBackFile && !isImagePath(docBackUrl) && (
              <a href={`${API}${docBackUrl}`} target="_blank" rel="noreferrer" className="text-xs text-blue-400 mt-2 inline-block">View uploaded PDF</a>
            )}
            {show('document_back') ? (
              <p className="text-xs text-red-400 mt-1.5 font-semibold">{show('document_back')}</p>
            ) : null}
          </div>
        </div>
        {uploading && (
          <p className="text-xs text-gold-light flex items-center gap-2">
            <span className="w-3 h-3 border border-gold border-t-transparent rounded-full animate-spin inline-block" />
            Uploading…
          </p>
        )}
      </div>
    </div>
  );
}

// ─── Step 3: Review ───────────────────────────────────────────────────────────
function Step3({ personal, document: doc, docFrontUrl, docBackUrl }) {
  const Row = ({ label, value }) => (
    <div className="flex items-center justify-between py-3 border-b last:border-0"
      style={{ borderColor: 'rgba(255,255,255,0.06)' }}>
      <span className="text-sm text-white">{label}</span>
      <span className="text-sm text-white font-semibold text-right max-w-[60%] truncate">{value || '—'}</span>
    </div>
  );

  return (
    <div className="space-y-5">
      <div className="rounded-2xl p-5"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <p className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          <User size={13} /> Personal Information
        </p>
        <Row label="Full Name"      value={personal.full_name} />
        <Row label="Date of Birth"  value={personal.date_of_birth} />
        <Row label="Nationality"    value={personal.nationality} />
        <Row label="Address"        value={personal.address} />
        <Row label="City"           value={personal.city} />
        <Row label="Country"        value={personal.country} />
        <Row label="Postal Code"    value={personal.postal_code} />
      </div>

      <div className="rounded-2xl p-5"
        style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <p className="text-xs font-bold text-white uppercase tracking-wider mb-3 flex items-center gap-2">
          <FileText size={13} /> Document Information
        </p>
        <Row label="Document Type"
          value={DOC_TYPES.find(d => d.value === doc.document_type)?.label || doc.document_type} />
        <Row label="Document Number" value={doc.document_number} />
        <Row label="Expiry Date"     value={doc.document_expiry} />
        <Row label="Front upload" value={docFrontUrl ? 'Attached' : '—'} />
        <Row label="Back upload" value={docBackUrl ? 'Attached' : '—'} />
      </div>

      {(docFrontUrl && isImagePath(docFrontUrl)) && (
        <div className="rounded-2xl p-4" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
          <p className="text-xs font-bold text-white/60 mb-2">ID preview (front)</p>
          <img src={`${API}${docFrontUrl}`} alt="" className="max-h-48 rounded-lg border border-white/10 object-contain" />
        </div>
      )}

      <div className="rounded-2xl p-5"
        style={{ background: 'rgba(14,164,171,0.06)', border: '1px solid rgba(14,164,171,0.2)' }}>
        <p className="text-sm text-white leading-relaxed">
          <span className="text-gold font-bold">Declaration: </span>
          By submitting, you confirm that all information is accurate and the documents belong to you.
          False submissions may result in permanent account suspension.
        </p>
      </div>
    </div>
  );
}

function parseApiError(data) {
  const d = data?.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) return d.map((x) => x.msg || JSON.stringify(x)).join('; ');
  return d || 'Request failed';
}

// ─── Step 2: Live camera selfie + Signzy face match ─────────────────────────
function SelfieVerificationPanel({ kyc, onRefresh, onApproved }) {
  const videoRef    = useRef(null);
  const canvasRef   = useRef(null);
  const streamRef   = useRef(null);

  // camera states: 'requesting' | 'live' | 'denied' | 'captured'
  const [camState,  setCamState]  = useState('requesting');
  const [captured,  setCaptured]  = useState(null);   // blob URL
  const [capturedBlob, setCapturedBlob] = useState(null);
  const [busy,      setBusy]      = useState(false);
  const [error,     setError]     = useState('');

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
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
      setError(denied
        ? 'Camera access was denied. Please allow camera access in your browser settings and try again.'
        : `Could not open camera: ${err.message}`);
    }
  }, []);

  // Start camera on mount; stop on unmount
  useEffect(() => {
    startCamera();
    return () => stopStream();
  }, [startCamera, stopStream]);

  const takePhoto = useCallback(() => {
    const video  = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas) return;
    canvas.width  = video.videoWidth  || 640;
    canvas.height = video.videoHeight || 480;
    canvas.getContext('2d').drawImage(video, 0, 0);
    canvas.toBlob(blob => {
      if (!blob) return;
      stopStream();
      const url = URL.createObjectURL(blob);
      setCaptured(url);
      setCapturedBlob(blob);
      setCamState('captured');
    }, 'image/jpeg', 0.92);
  }, [stopStream]);

  const retake = useCallback(() => {
    if (captured) { URL.revokeObjectURL(captured); setCaptured(null); }
    setCapturedBlob(null);
    setCamState('requesting');
    startCamera();
  }, [captured, startCamera]);

  const uploadAndVerify = async () => {
    if (!capturedBlob) return;
    setBusy(true);
    setError('');
    try {
      // 1. Upload selfie
      const fd = new FormData();
      fd.append('document_selfie', capturedBlob, 'selfie.jpg');
      const upRes = await authFetch(`${API}/api/kyc/upload`, { method: 'POST', body: fd });
      const upData = await upRes.json();
      if (!upRes.ok) throw new Error(parseApiError(upData));

      // 2. Immediately run face match
      const fmRes  = await authFetch(`${API}/api/kyc/face-match`, { method: 'POST' });
      const fmData = await fmRes.json();
      if (!fmRes.ok) throw new Error(parseApiError(fmData));

      await onRefresh();
      if (fmData.verified || fmData.kyc_status === 'approved') {
        onApproved?.();
      } else {
        setError(fmData.message || 'Face match failed — retake with better lighting and no glasses.');
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
    <div className="space-y-5">
      <div className="rounded-2xl p-6 space-y-4"
        style={{ background: 'rgba(96,165,250,0.06)', border: '1px solid rgba(96,165,250,0.2)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(96,165,250,0.12)', border: '1px solid rgba(96,165,250,0.25)' }}>
            <Camera size={20} className="text-blue-400" />
          </div>
          <div>
            <p className="text-base font-bold text-white">Selfie verification</p>
            <p className="text-xs text-white/50 mt-0.5">Live camera — we compare your face to your Aadhaar photo</p>
          </div>
        </div>

        {error && (
          <div className="rounded-xl px-4 py-2.5 text-sm text-red-300"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            {error}
          </div>
        )}

        {/* Permission denied state */}
        {camState === 'denied' && (
          <div className="flex flex-col items-center gap-4 py-6">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
              <Camera size={26} className="text-red-400" />
            </div>
            <p className="text-sm text-white/60 text-center max-w-xs">
              Camera access is required for live selfie verification.<br />
              Allow camera access in your browser and click <strong className="text-white">Try again</strong>.
            </p>
            <button type="button" onClick={startCamera}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white"
              style={{ border: '1px solid rgba(255,255,255,0.15)', background: 'rgba(255,255,255,0.06)' }}>
              <Camera size={15} /> Try again
            </button>
          </div>
        )}

        {/* Live camera view */}
        {(camState === 'live' || camState === 'requesting') && (
          <div className="flex flex-col items-center gap-4">
            <div className="relative rounded-xl overflow-hidden bg-black/40 border border-white/10 w-full max-w-sm aspect-[4/3]">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted />
              {camState === 'requesting' && (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Loader2 size={32} className="animate-spin text-white/40" />
                </div>
              )}
              {/* Face guide oval */}
              {camState === 'live' && (
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-36 h-44 rounded-full border-2 border-blue-400/60"
                    style={{ boxShadow: '0 0 0 9999px rgba(0,0,0,0.35)' }} />
                </div>
              )}
            </div>
            {camState === 'live' && (
              <button type="button" onClick={takePhoto}
                className="inline-flex items-center gap-2 px-7 py-3 rounded-xl text-sm font-bold text-[#05070d]"
                style={{ background: 'linear-gradient(135deg, #0EA4AB, #C5E35B)' }}>
                <Camera size={16} /> Take selfie
              </button>
            )}
            <p className="text-xs text-white/40 text-center">
              Centre your face in the oval, then tap <strong className="text-white/60">Take selfie</strong>.
            </p>
          </div>
        )}

        {/* Captured preview */}
        {camState === 'captured' && captured && (
          <div className="flex flex-col items-center gap-4">
            <img src={captured} alt="Selfie preview"
              className="rounded-xl max-h-56 object-cover border border-white/10 w-full max-w-sm" />
            <div className="flex flex-wrap gap-3 justify-center">
              <button type="button" onClick={retake} disabled={busy}
                className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-bold text-white/70 hover:text-white disabled:opacity-50"
                style={{ border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)' }}>
                Retake
              </button>
              <button type="button" onClick={uploadAndVerify} disabled={busy}
                className="inline-flex items-center gap-2 px-6 py-2.5 rounded-xl text-sm font-bold text-[#05070d] disabled:opacity-50"
                style={{ background: 'linear-gradient(135deg, #0EA4AB, #C5E35B)' }}>
                {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
                {busy ? 'Verifying…' : 'Submit & verify'}
              </button>
            </div>
            <p className="text-xs text-white/40 text-center">Happy with the photo? Hit <strong className="text-white/60">Submit & verify</strong>.</p>
          </div>
        )}

        <canvas ref={canvasRef} className="hidden" />

        {fm && (
          <p className={`text-sm font-semibold ${fm.verified ? 'text-green-400' : 'text-red-400'}`}>
            {fm.verified ? 'Face match passed' : 'Face match failed'}
            {fm.match_percentage ? ` — ${fm.match_percentage}` : ''}
          </p>
        )}
      </div>

      <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2">Tips</p>
        <ul className="space-y-1.5 text-sm text-white/60 list-disc list-inside">
          <li>Use good lighting and face the camera directly.</li>
          <li>Remove hats, masks, and sunglasses.</li>
          <li>Keep your face centred in the oval guide.</li>
        </ul>
      </div>
    </div>
  );
}

// ─── PAN verify panel (when PAN not linked in DigiLocker) ────────────────────
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
    <div className="space-y-5">
      <div className="rounded-2xl p-6 space-y-4"
        style={{ background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.2)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(167,139,250,0.12)', border: '1px solid rgba(14,164,171,0.25)' }}>
            <CreditCard size={20} className="text-violet-400" />
          </div>
          <div>
            <p className="text-base font-bold text-white">Verify your PAN</p>
            <p className="text-xs text-white/50 mt-0.5">PAN was not found in your DigiLocker account</p>
          </div>
        </div>
        <p className="text-sm text-white/65 leading-relaxed">
          We verify your PAN with the Income Tax Department using the same name and date of birth
          from your Aadhaar. Enter your 10-character PAN below.
        </p>

        <div className="rounded-xl p-4 space-y-2 text-sm"
          style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)' }}>
          <div className="flex justify-between gap-4">
            <span className="text-white/45 shrink-0">Name (from Aadhaar)</span>
            <span className="text-white font-semibold text-right">{personal.full_name || '—'}</span>
          </div>
          <div className="flex justify-between gap-4">
            <span className="text-white/45 shrink-0">Date of birth</span>
            <span className="text-white font-semibold">{formatDobDisplay(personal.date_of_birth)}</span>
          </div>
        </div>

        {error && (
          <div className="rounded-xl px-4 py-2.5 text-sm text-red-300"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            {error}
          </div>
        )}

        {pv && !pv.verified && kyc?.status === 'pan_verify_failed' && !error && (
          <div className="rounded-xl px-4 py-2.5 text-sm text-red-300"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            {pv.message || 'Previous PAN verification failed. Try again.'}
          </div>
        )}

        <div>
          <label className="block text-sm font-semibold text-white mb-2">
            PAN number <span className="text-red-400">*</span>
          </label>
          <input
            type="text"
            value={pan}
            onChange={(e) => setPan(normalizePanInput(e.target.value))}
            placeholder="ABCDE1234F"
            maxLength={10}
            autoComplete="off"
            className="w-full rounded-xl px-4 py-3.5 text-white text-base font-mono tracking-widest uppercase outline-none focus:border-gold/50 transition-colors placeholder:text-white/35"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.09)' }}
          />
        </div>

        <button
          type="button"
          onClick={submitPan}
          disabled={busy || pan.length < 10}
          className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-[#05070d] disabled:opacity-50"
          style={{ background: 'linear-gradient(135deg, #0EA4AB, #C5E35B)' }}
        >
          {busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle size={15} />}
          {busy ? 'Verifying PAN…' : 'Verify PAN'}
        </button>
      </div>

      <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2">Why PAN?</p>
        <ul className="space-y-1.5 text-sm text-white/60 list-disc list-inside">
          <li>Regulatory requirement for Indian exchange onboarding.</li>
          <li>Name and DOB must match your Aadhaar exactly.</li>
          <li>Link PAN in DigiLocker next time to skip this step.</li>
        </ul>
      </div>
    </div>
  );
}

// ─── DigiLocker panel (auto KYC mode — step 1) ───────────────────────────────
function DigiLockerPanel({ kyc, onCheckStatus, faceMatchRequired, panVerifyRequired, syncError, onClearSyncError }) {
  const [busy,        setBusy]        = useState(false);
  const [checking,    setChecking]    = useState(false);
  const [error,       setError]       = useState('');
  const [digiUrl,     setDigiUrl]     = useState('');
  const isPending = kyc?.status === 'digilocker_pending';
  const isFailed  = kyc?.status === 'digilocker_failed';

  const initDigiLocker = async () => {
    setBusy(true); setError('');
    onClearSyncError?.();
    try {
      const res  = await authFetch(`${API}/api/kyc/digilocker/init`, { method: 'POST' });
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
    <div className="space-y-5">
      <div className="rounded-2xl p-6 space-y-4"
        style={{ background: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.2)' }}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
            style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.25)' }}>
            <Shield size={20} className="text-green-400" />
          </div>
          <div>
            <p className="text-base font-bold text-white">Verify with DigiLocker</p>
            <p className="text-xs text-white/50 mt-0.5">Instant Aadhaar-based identity verification</p>
          </div>
        </div>
        <p className="text-sm text-white/65 leading-relaxed">
          Click the button below to open DigiLocker. Log in with your Aadhaar-linked account
          and grant consent.
          {faceMatchRequired || panVerifyRequired
            ? ` After DigiLocker, you will${panVerifyRequired ? ' verify PAN and' : ''}${faceMatchRequired ? ' complete selfie verification' : ' finish verification'}.`
            : <> Your KYC will be <span className="text-green-400 font-semibold">approved instantly</span> — no document upload required.</>}
        </p>
        {error && (
          <div className="rounded-xl px-4 py-2.5 text-sm text-red-300"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            {error}
          </div>
        )}
        {syncError && !error && (
          <div className="rounded-xl px-4 py-2.5 text-sm text-red-300"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            {syncError}
          </div>
        )}
        {isPending && !digiUrl && !syncError && (
          <div className="rounded-xl px-4 py-2.5 text-sm text-gold-light"
            style={{ background: 'rgba(14,164,171,0.1)', border: '1px solid rgba(14,164,171,0.25)' }}>
            Finish DigiLocker in the other tab, then return here and click <strong className="text-white">Check status</strong>.
          </div>
        )}
        {isFailed && (
          <div className="rounded-xl px-4 py-2.5 text-sm text-red-300"
            style={{ background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.25)' }}>
            Previous DigiLocker attempt failed. Please try again.
          </div>
        )}
        <div className="flex flex-wrap gap-3">
          <button
            onClick={initDigiLocker}
            disabled={busy}
            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl text-sm font-bold text-[#05070d] disabled:opacity-50"
            style={{ background: 'linear-gradient(135deg,#22c55e,#16a34a)' }}
          >
            {busy ? <Loader2 size={15} className="animate-spin" /> : <ExternalLink size={15} />}
            {busy ? 'Opening DigiLocker…' : isPending ? 'Re-open DigiLocker' : 'Open DigiLocker'}
          </button>
          {(isPending || isFailed) && (
            <button
              type="button"
              onClick={checkStatus}
              disabled={busy || checking}
              className="inline-flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-bold text-white/70 hover:text-white transition-colors disabled:opacity-50"
              style={{ border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(255,255,255,0.04)' }}
            >
              {checking ? <Loader2 size={15} className="animate-spin" /> : null}
              Check status
            </button>
          )}
        </div>
        {digiUrl && (
          <p className="text-xs text-white/40">
            If the tab did not open automatically,{' '}
            <a href={digiUrl} target="_blank" rel="noopener noreferrer" className="text-green-400 underline">
              click here
            </a>.
          </p>
        )}
      </div>
      <div className="rounded-2xl p-5" style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
        <p className="text-xs font-bold text-white/50 uppercase tracking-wider mb-2">How it works</p>
        <ol className="space-y-1.5 text-sm text-white/60 list-decimal list-inside">
          <li>Click "Open DigiLocker" — a new tab opens with the DigiLocker sign-in.</li>
          <li>Log in or sign up with your Aadhaar-linked mobile number.</li>
          <li>Grant consent to share your Aadhaar details with IBO.</li>
          <li>Return to this page
            {panVerifyRequired || faceMatchRequired
              ? ` to continue${panVerifyRequired ? ' with PAN verification' : ''}${faceMatchRequired ? ' and selfie verification' : ''}.`
              : ' — your KYC will be approved automatically.'}
          </li>
        </ol>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function KYCPage() {
  const { user, updateUser, fetchKyc: syncAuthKyc } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const digiReturnHandled = useRef(false);
  const [kyc,        setKyc]        = useState(null);
  const [loading,    setLoading]    = useState(true);
  const [kycMode,    setKycMode]    = useState('manual');   // "manual" | "auto" | "disabled"
  const [faceMatchRequired, setFaceMatchRequired] = useState(false);
  const [panVerifyRequired, setPanVerifyRequired] = useState(false);
  const [digiSyncError, setDigiSyncError] = useState('');
  const [step,       setStep]       = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitted,  setSubmitted]  = useState(false);
  const [error,      setError]      = useState('');

  const [personal, setPersonal] = useState({
    full_name: user?.name || '', date_of_birth: '', nationality: '',
    address: '', city: '', country: '', postal_code: '',
  });
  const [docInfo, setDocInfo] = useState({
    document_type: '', document_number: '', document_expiry: '',
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
  /** When API returns a stricter postal max (e.g. 10), remember it for live validation without another failed submit. */
  const [postalMaxLearned, setPostalMaxLearned] = useState(null);

  const loadKycStatus = useCallback(() => {
    return authFetch(`${API}/api/kyc/status`)
      .then(r => r.json())
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

  // After Signzy redirects the browser to successRedirectUrl (?requestId=&status=success)
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
    setPersonal(p => ({ ...p, [k]: v }));
  };
  const updateDoc = (k, v) => {
    setServerDocumentErrors({});
    setDocInfo(d => ({ ...d, [k]: v }));
  };
  const blurPersonalField = (k) => setTouchedPersonal((t) => ({ ...t, [k]: true }));
  const blurDocField = (k) => setTouchedDoc((t) => ({ ...t, [k]: true }));

  const handlePickFront = (f) => {
    setServerDocumentErrors({});
    setIdFrontFile(f);
    setTouchedDoc(t => ({ ...t, document_front: true }));
  };
  const handlePickBack = (f) => {
    setServerDocumentErrors({});
    setIdBackFile(f);
    setTouchedDoc(t => ({ ...t, document_back: true }));
  };

  const hasIdFront = !!(idFrontFile || docFrontUrl);

  const effectivePostalMaxLen = useMemo(() => {
    const fromLearned =
      postalMaxLearned != null && Number.isFinite(postalMaxLearned)
        ? postalMaxLearned
        : null;
    const fromEnv = ENV_POSTAL_MAX_LEN;
    const raw = fromLearned ?? fromEnv ?? KYC_POSTAL_CATALOG_MAX;
    return Math.min(
      KYC_POSTAL_CATALOG_MAX,
      Math.max(2, raw),
    );
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
    setSubmitting(true); setError('');
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
      const res  = await authFetch(`${API}/api/kyc/submit`, {
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
    } finally { setSubmitting(false); }
  };

  const isApproved  = kyc?.status === 'approved';
  const isPending   = kyc?.status === 'pending';
  const needsForm   = !submitted && (kyc?.status === 'rejected' || kyc?.status === 'digilocker_failed' || kyc?.status === 'face_match_failed' || !kyc || kyc.status === 'unverified');
  const showForm    = needsForm && kycMode === 'manual';
  const showAutoKyc = kycMode === 'auto' && !submitted && !isApproved && !isPending;
  const panAlreadyOnFile = !!(kyc?.pan_info?.linked || kyc?.pan_info?.verified);
  const needPanStep = panVerifyRequired && !panAlreadyOnFile;
  const autoSteps = useMemo(
    () => buildAutoSteps(needPanStep, faceMatchRequired),
    [needPanStep, faceMatchRequired],
  );

  const showDigiLockerStep = showAutoKyc && ['digilocker_pending', 'digilocker_failed', 'unverified'].includes(kyc?.status || 'unverified');
  const showPanStep = showAutoKyc && needPanStep && ['awaiting_pan', 'pan_verify_failed'].includes(kyc?.status);
  const showSelfieStep = showAutoKyc && faceMatchRequired && ['awaiting_selfie', 'face_match_failed'].includes(kyc?.status);

  const autoStepIndex = useMemo(() => {
    if (showSelfieStep) return Math.max(0, autoSteps.length - 1);
    if (showPanStep) return autoSteps.findIndex((s) => s.label === 'PAN');
    return 0;
  }, [showSelfieStep, showPanStep, autoSteps]);

  const showDisabled   = kycMode === 'disabled' && !isApproved && !isPending;

  const handleKycApproved = useCallback(() => {
    updateUser({ kyc_status: 'approved' });
  }, [updateUser]);

  if (loading) {
    return (
      <div className="ibo-page flex items-center justify-center">
        <div className="w-10 h-10 border-2 border-gold border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="ibo-page font-ui flex flex-col xl:flex-row">

      {/* ══ LEFT — Info panel ═════════════════════════════════════════════════ */}
      <div className="hidden xl:flex flex-col w-[400px] flex-shrink-0
        relative overflow-hidden px-12 py-12 border-r border-[color:var(--ibo-border-solid)]"
        style={{ background: 'var(--ibo-card)' }}>

        {/* Background */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: 'radial-gradient(ellipse at 20% 20%, rgba(14,164,171,0.14) 0%, transparent 55%), radial-gradient(ellipse at 80% 90%, rgba(197,227,91,0.08) 0%, transparent 45%)' }} />
        <div className="absolute inset-0 opacity-[.035] pointer-events-none"
          style={{ backgroundImage: 'linear-gradient(#0EA4AB 1px,transparent 1px),linear-gradient(90deg,#0EA4AB 1px,transparent 1px)', backgroundSize: '44px 44px' }} />

        {/* Icon */}
        <motion.div initial={{ opacity: 0, y: -16 }} animate={{ opacity: 1, y: 0 }}
          className="relative z-10 mb-10">
          <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
            style={{ background: 'rgba(14,164,171,0.15)', border: '1px solid rgba(14,164,171,0.35)' }}>
            <Shield size={30} className="text-gold" />
          </div>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }} className="relative z-10 mb-10">
          <h2 className="font-display text-4xl font-extrabold text-ink leading-[1.15] mb-4">
            Identity<br />
            <span className="text-gradient">Verification</span>
          </h2>
          <p className="text-ink-secondary text-base leading-relaxed">
            Complete KYC to unlock your full exchange access. This one-time process takes less than 5 minutes.
          </p>
        </motion.div>

        {/* Benefits */}
        <div className="relative z-10 space-y-4 flex-1">
          {KYC_BENEFITS.map(({ icon: Icon, color, title, desc }, i) => (
            <motion.div key={title}
              initial={{ opacity: 0, x: -16 }} animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.2 + i * 0.07 }}
              className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
                style={{ background: `${color}18`, border: `1px solid ${color}30` }}>
                <Icon size={18} style={{ color }} />
              </div>
              <div>
                <p className="text-sm font-bold text-ink">{title}</p>
                <p className="text-xs text-ink-muted">{desc}</p>
              </div>
            </motion.div>
          ))}
        </div>

        {/* Step progress */}
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.6 }}
          className="relative z-10 mt-8 ibo-account-panel-soft !p-5 space-y-2">
          <p className="ibo-field-label">Verification Process</p>
          {(kycMode === 'auto' ? autoSteps : STEPS).map(({ label, icon: Icon }, i) => (
            <div key={label} className="flex items-center gap-3">
              <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                i < (kycMode === 'auto' ? autoStepIndex : step) ? 'bg-green-500 text-white' : i === (kycMode === 'auto' ? autoStepIndex : step) ? 'text-surface-dark' : 'text-ink-muted'}`}
                style={i === (kycMode === 'auto' ? autoStepIndex : step) ? { background: 'linear-gradient(135deg, #0EA4AB, #C5E35B)' }
                  : i < (kycMode === 'auto' ? autoStepIndex : step) ? {} : { background: 'var(--ibo-elevated)', border: '1px solid var(--ibo-border)' }}>
                {i < (kycMode === 'auto' ? autoStepIndex : step) ? '✓' : i + 1}
              </div>
              <span className={`text-sm font-semibold ${
                i === (kycMode === 'auto' ? autoStepIndex : step) ? 'text-gold-light' : i < (kycMode === 'auto' ? autoStepIndex : step) ? 'text-green-400' : 'text-ink-muted'}`}>
                {label}
              </span>
            </div>
          ))}
        </motion.div>
      </div>

      {/* ══ RIGHT — Content area ══════════════════════════════════════════════ */}
      <div className="flex-1 overflow-y-auto px-6 lg:px-12 py-10">
        <div className="w-full max-w-6xl mx-auto">

          {/* Page header */}
          <div className="ibo-account-hero !mb-8">
            <p className="ibo-eyebrow mb-1.5">Compliance</p>
            <h1 className="ibo-account-title">KYC Verification</h1>
            <p className="ibo-account-subtitle">
              Verify your identity to unlock full trading and withdrawal access.
            </p>
          </div>

          {/* Status banner */}
          {kyc && kyc.status !== 'unverified' && (
            <div className="mb-8"><StatusBanner kyc={kyc} /></div>
          )}

          {/* Success screen */}
          {submitted && (
            <motion.div initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }}
              className="ibo-account-panel p-10 text-center space-y-5">
              <div className="w-20 h-20 rounded-2xl flex items-center justify-center mx-auto"
                style={{ background: 'rgba(14,164,171,0.15)', border: '1px solid rgba(14,164,171,0.3)' }}>
                <Clock size={36} className="text-gold" />
              </div>
              <h2 className="font-display text-2xl font-extrabold text-ink">KYC Submitted Successfully!</h2>
              <p className="text-ink-secondary text-base leading-relaxed max-w-md mx-auto">
                Your identity documents are under review. We'll notify you via email once your
                identity is verified — usually within 1–2 business days.
              </p>
              <div className="flex items-center justify-center gap-2 text-gold font-semibold text-sm">
                <Clock size={15} /> Application ID: {Date.now().toString(36).toUpperCase()}
              </div>
            </motion.div>
          )}

          {/* Auto KYC — step 1: DigiLocker */}
          {showDigiLockerStep && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl p-8"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              {autoSteps.length > 1 && <AutoStepIndicator steps={autoSteps} current={autoStepIndex} />}
              <DigiLockerPanel
                kyc={kyc}
                faceMatchRequired={faceMatchRequired}
                panVerifyRequired={needPanStep}
                syncError={digiSyncError}
                onClearSyncError={() => setDigiSyncError('')}
                onCheckStatus={handleDigiCheckStatus}
              />
            </motion.div>
          )}

          {/* Auto KYC — PAN verify (when not linked in DigiLocker) */}
          {showPanStep && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl p-8"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <AutoStepIndicator steps={autoSteps} current={autoStepIndex} />
              <PanVerificationPanel kyc={kyc} onRefresh={refreshKyc} onApproved={handleKycApproved} />
            </motion.div>
          )}

          {/* Auto KYC — Selfie + face match */}
          {showSelfieStep && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl p-8"
              style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)' }}>
              <AutoStepIndicator steps={autoSteps} current={autoStepIndex} />
              <SelfieVerificationPanel
                kyc={kyc}
                onRefresh={refreshKyc}
                onApproved={handleKycApproved}
              />
            </motion.div>
          )}

          {/* Disabled mode */}
          {showDisabled && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="rounded-2xl p-10 text-center space-y-4"
              style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto"
                style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.25)' }}>
                <AlertCircle size={28} className="text-red-400" />
              </div>
              <p className="text-lg font-bold text-white">KYC Verification Temporarily Unavailable</p>
              <p className="text-white/60 text-sm max-w-sm mx-auto">
                Identity verification has been paused by the platform. Please check back later or contact support.
              </p>
            </motion.div>
          )}

          {/* KYC Form (manual mode) */}
          {showForm && (
            <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
              className="ibo-account-panel !p-8">
              <StepIndicator current={step} />

              <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.25 }}>
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
                  <Step3 personal={personal} document={docInfo} docFrontUrl={docFrontUrl} docBackUrl={docBackUrl} />
                )}
              </motion.div>

              {error && (
                <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }}
                  className="mt-5 ibo-notice-danger !text-sm flex items-center gap-3">
                  <AlertCircle size={16} /> {error}
                </motion.div>
              )}

              {/* Navigation */}
              <div className="flex items-center justify-between mt-8 pt-6 border-t border-[color:var(--ibo-border)]">
                <button onClick={() => { setError(''); setStep(s => s - 1); }} disabled={step === 0}
                  className="ibo-btn-outline disabled:opacity-0">
                  <ChevronLeft size={17} /> Back
                </button>

                {step < 2 ? (
                  <button
                    type="button"
                    onClick={() => handleNext()}
                    disabled={uploadingDocs}
                    className="ibo-btn-primary px-8 py-3 disabled:opacity-40"
                  >
                    Continue <ChevronRight size={17} />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={handleSubmit}
                    disabled={submitting || !step1Valid || !step2Valid}
                    className="ibo-btn-primary px-8 py-3 disabled:opacity-40"
                  >
                    {submitting
                      ? <span className="w-5 h-5 border-2 border-surface-dark border-t-transparent rounded-full animate-spin" />
                      : <><CheckCircle size={17} /> {kyc?.status === 'rejected' ? 'Resubmit KYC' : 'Submit KYC'}</>}
                  </button>
                )}
              </div>
            </motion.div>
          )}

          {/* Pending — no form */}
          {!submitted && isPending && !showDigiLockerStep && !showPanStep && !showSelfieStep && (
            <div className="ibo-account-panel p-8 text-center space-y-4">
              <div className="w-16 h-16 rounded-2xl flex items-center justify-center mx-auto bg-gold/15 border border-gold/30">
                <Clock size={28} className="text-gold" />
              </div>
              <p className="text-lg font-display font-bold text-ink">Your application is under review</p>
              <p className="text-ink-secondary text-base max-w-md mx-auto">
                We are processing your documents. You will receive an email notification once the
                review is complete (1–2 business days).
              </p>
            </div>
          )}

        </div>
      </div>
    </div>
  );
}
