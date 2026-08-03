import { useEffect, useRef, useState, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import {
  ArrowLeft, Send, Loader2, AlertCircle, CheckCircle2, Clock,
  ShieldCheck, Upload, X, Lock, Flag, MessageCircle, Info,
} from 'lucide-react';
import { p2pApi, p2pWs, p2pMediaUrl } from '@/services/p2pApi';
import { useAuth } from '@/context/AuthContext';
import P2PModal from './P2PModal';

const STEPS = ['Order Opened', 'Payment Sent', 'Crypto Released'];
const STEP_IDX = { in_progress: 1, paid_marked: 2, completed: 3, cancelled: 0, disputed: 2 };

const ST_BADGE = {
  in_progress: { label: 'Awaiting Payment', cls: 'border-gold/30 bg-[rgba(91,184,255,0.1)] text-gold' },
  paid_marked: { label: 'Awaiting Release', cls: 'border-[#0EA4AB]/30 bg-[#0EA4AB]/10 text-[#5BB8FF]' },
  completed:   { label: 'Completed',        cls: 'border-green-400/30 bg-green-400/10 text-green-400' },
  cancelled:   { label: 'Cancelled',        cls: 'border-white/15 bg-white/5 text-white/45' },
  disputed:    { label: 'Disputed',         cls: 'border-red-400/30 bg-red-400/10 text-red-400' },
};

const fmtTime = (s) => {
  try { return new Date(s).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return s || '—'; }
};

export default function P2POrderDetailPage() {
  const { orderId } = useParams();
  const { user }    = useAuth();

  const [order, setOrder]           = useState(null);
  const [msgs, setMsgs]             = useState([]);
  const [msgText, setMsgText]       = useState('');
  const [totpCode, setTotpCode]     = useState('');
  const [payNote, setPayNote]       = useState('');
  const [file, setFile]             = useState(null);
  const [preview, setPreview]       = useState('');
  const [loading, setLoading]       = useState(true);
  const [error, setError]           = useState('');
  const [actionBusy, setActionBusy] = useState({});
  const [showDispute, setShowDispute] = useState(false);
  const [disputeReason, setDisputeReason]     = useState('');
  const [disputeEvidence, setDisputeEvidence] = useState('');

  const chatRef = useRef(null);
  const fileRef = useRef(null);

  const myUid    = user?.uid;
  const isBuyer  = order?.buyer_id  === myUid;
  const isSeller = order?.seller_id === myUid;
  const step     = STEP_IDX[order?.status] ?? 1;
  const canMarkPaid = isBuyer  && order?.status === 'in_progress';
  const canRelease  = isSeller && order?.status === 'paid_marked';
  const canCancel   = ['in_progress'].includes(order?.status) && (isBuyer || isSeller);
  const canDispute  = ['in_progress', 'paid_marked'].includes(order?.status) && (isBuyer || isSeller);
  const isDone      = ['completed', 'cancelled', 'refunded'].includes(order?.status);

  const loadOrder = useCallback(async () => {
    try { const d = await p2pApi.orderDetail(orderId); setOrder(d); }
    catch (e) { setError(e.message); }
  }, [orderId]);

  const loadChat = useCallback(async () => {
    try { const d = await p2pApi.orderChat(orderId); setMsgs(d.messages || []); }
    catch {}
  }, [orderId]);

  useEffect(() => {
    Promise.all([loadOrder(), loadChat()]).finally(() => setLoading(false));
  }, [loadOrder, loadChat]);

  useEffect(() => {
    if (chatRef.current) chatRef.current.scrollTop = chatRef.current.scrollHeight;
  }, [msgs]);

  useEffect(() => {
    const token = localStorage.getItem('ibo_ex_token');
    if (!token) return;
    const ws = p2pWs(orderId, token);
    ws.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data);
        if (ev.type === 'order_update') setOrder((o) => ({ ...o, ...ev.data }));
        else if (ev.type === 'chat_message') setMsgs((m) => [...m, ev.data]);
      } catch {}
    };
    return () => ws.close();
  }, [orderId]);

  const ab  = (k) => actionBusy[k];
  const sab = (k, v) => setActionBusy((s) => ({ ...s, [k]: v }));

  const sendMsg = async (e) => {
    e.preventDefault();
    if (!msgText.trim() && !file) return;
    sab('upload', true);
    try {
      if (file) {
        const fd = new FormData();
        fd.append('image', file);
        await p2pApi.uploadChatImage(orderId, fd);
        setFile(null);
        setPreview('');
      }
      if (msgText.trim()) {
        await p2pApi.sendMessage(orderId, { body: msgText.trim() });
        setMsgText('');
      }
      loadChat();
    } catch (err) {
      alert(err.message || 'Failed to send message');
    } finally {
      sab('upload', false);
    }
  };

  const markPaid = async () => {
    sab('pay', true);
    try {
      await p2pApi.markPaid(orderId, { note: payNote.trim() || undefined });
      loadOrder(); loadChat();
    }
    catch (e) { alert(e.message); }
    finally { sab('pay', false); }
  };

  const release = async () => {
    if (!totpCode) { alert('Enter your 2FA code first.'); return; }
    sab('release', true);
    try { await p2pApi.releaseCrypto(orderId, { totp_code: totpCode }); setTotpCode(''); loadOrder(); loadChat(); }
    catch (e) { alert(e.message); }
    finally { sab('release', false); }
  };

  const cancel = async () => {
    if (!window.confirm('Cancel this order?')) return;
    sab('cancel', true);
    try { await p2pApi.cancelOrder(orderId, { reason: 'Cancelled by user' }); loadOrder(); loadChat(); }
    catch (e) { alert(e.message); }
    finally { sab('cancel', false); }
  };

  const submitDispute = async () => {
    if (!disputeReason) return;
    sab('dispute', true);
    try {
      await p2pApi.openDispute(orderId, {
        reason: disputeReason,
        description: disputeEvidence.trim(),
        evidence_urls: [],
      });
      setShowDispute(false); loadOrder(); loadChat();
    } catch (e) { alert(e.message); }
    finally { sab('dispute', false); }
  };

  if (loading) return (
    <div className="ibo-page flex items-center justify-center">
      <Loader2 size={20} className="animate-spin text-[#0EA4AB]" />
    </div>
  );
  if (!order) return (
    <div className="ibo-page flex items-center justify-center text-red-400 text-sm">
      <AlertCircle size={14} className="mr-2" />{error || 'Order not found.'}
    </div>
  );

  const st = ST_BADGE[order.status] || ST_BADGE.cancelled;
  const counterparty = isBuyer ? order.seller_info : order.buyer_info;
  const pm = order.payment_method_snapshot || {};

  return (
    <div className="ibo-page font-ui">
      <div className="w-full px-4 sm:px-5 md:px-6 lg:px-8 xl:px-10 2xl:px-12 py-6 sm:py-8 pb-16">

        {/* ── Top bar ──────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-6 flex-wrap">
          <Link to="/p2p/orders"
            className="ibo-hover-border flex items-center justify-center w-9 h-9 rounded-xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] text-white/60 hover:text-white transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h1 className="text-white font-bold text-xl tracking-tight">Order <span className="font-mono text-[#5BB8FF]">{order.order_id}</span></h1>
            <p className="text-white/40 text-xs mt-0.5">Opened {fmtTime(order.created_at)}</p>
          </div>
          <span className={`ml-auto inline-flex items-center rounded-full border px-3 py-1 text-xs font-bold uppercase ${st.cls}`}>
            {st.label}
          </span>
        </div>

        {/* ── Progress stepper ─────────────────────────────────────── */}
        {!isDone && (
          <div className="rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-5 mb-6">
            <div className="flex items-center">
              {STEPS.map((s, i) => {
                const done = step > i + 1;
                const cur  = step === i + 1;
                return (
                  <div key={s} className="flex items-center flex-1 last:flex-none">
                    <div className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-extrabold border-2 shrink-0 transition-all ${
                      done ? 'border-green-500 bg-green-500 text-white'
                      : cur ? 'border-[#0EA4AB] bg-transparent text-[#5BB8FF]'
                      : 'border-white/15 bg-transparent text-white/25'
                    }`}>
                      {done ? <CheckCircle2 size={15} /> : i + 1}
                    </div>
                    {i < 2 && (
                      <div className="flex-1 h-px mx-2" style={{ background: done ? '#22c55e' : 'rgba(255,255,255,0.08)' }} />
                    )}
                  </div>
                );
              })}
            </div>
            <div className="flex justify-between mt-3">
              {STEPS.map((s, i) => (
                <p key={s} className={`text-xs font-semibold ${
                  step > i + 1 ? 'text-green-400' : step === i + 1 ? 'text-[#5BB8FF]' : 'text-white/25'
                }`}>{s}</p>
              ))}
            </div>
          </div>
        )}

        {/* Status banners */}
        {order.status === 'completed' && (
          <div className="flex items-center gap-3 rounded-2xl p-4 mb-6"
            style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.2)' }}>
            <CheckCircle2 size={18} className="text-green-400 shrink-0" />
            <div><p className="font-bold text-green-400">Order Completed</p><p className="text-sm text-white/55 mt-0.5">Crypto has been released to the buyer. Thank you for trading!</p></div>
          </div>
        )}
        {order.status === 'cancelled' && (
          <div className="flex items-center gap-3 rounded-2xl p-4 mb-6"
            style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid var(--ibo-border-solid)' }}>
            <X size={18} className="text-white/40 shrink-0" />
            <div><p className="font-bold text-white/60">Order Cancelled</p><p className="text-sm text-white/35 mt-0.5">Funds have been returned to the seller.</p></div>
          </div>
        )}
        {order.status === 'disputed' && (
          <div className="flex items-center gap-3 rounded-2xl p-4 mb-6"
            style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <Flag size={18} className="text-red-400 shrink-0" />
            <div><p className="font-bold text-red-400">Dispute Under Review</p><p className="text-sm text-white/55 mt-0.5">Our team is reviewing this case. Please respond promptly to any admin requests.</p></div>
          </div>
        )}

        <div className="grid lg:grid-cols-[1fr,360px] gap-6">

          {/* ── Chat panel ───────────────────────────────────────── */}
          <div className="flex flex-col rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)]" style={{ minHeight: 520 }}>
            {/* Chat header */}
            <div className="px-5 py-4 border-b border-[color:var(--ibo-border-solid)] flex items-center gap-3">
              <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: 'rgba(14,164,171,0.12)', border: '1px solid rgba(14,164,171,0.2)' }}>
                <MessageCircle size={13} className="text-[#5BB8FF]" />
              </div>
              <span className="text-white font-bold text-sm">Order Chat</span>
              {counterparty && (
                <div className="ml-auto flex items-center gap-2 text-xs text-white/45">
                  <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-[#5BB8FF]"
                    style={{ background: 'rgba(14,164,171,0.15)', border: '1px solid rgba(14,164,171,0.2)' }}>
                    {(counterparty.nickname || 'T')[0]}
                  </div>
                  <span>{counterparty.nickname}</span>
                  {counterparty.is_merchant && <ShieldCheck size={11} className="text-[#5BB8FF]" />}
                </div>
              )}
            </div>

            {/* Messages */}
            <div ref={chatRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-3 scrollbar-hide" style={{ maxHeight: 400 }}>
              {msgs.map((m, i) => {
                if (m.sender_id === 'system' || m.sender_id === 'SYSTEM') {
                  return (
                    <div key={i} className="text-center py-1">
                      <span className="text-[11px] text-white/35 px-3 py-1 rounded-full italic"
                        style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.06)' }}>
                        {m.body || m.message}
                      </span>
                    </div>
                  );
                }
                const isMe = m.sender_id === myUid;
                return (
                  <div key={i} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                    <div className={`max-w-[78%] px-4 py-2.5 rounded-2xl text-sm leading-relaxed ${
                      isMe ? 'rounded-br-sm text-white' : 'rounded-bl-sm text-white/90'
                    }`}
                      style={isMe
                        ? { background: 'rgba(14,164,171,0.18)', border: '1px solid rgba(14,164,171,0.2)' }
                        : { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.06)' }}>
                      {(m.attachment_url || m.image_url) ? (() => {
                        const imgSrc = p2pMediaUrl(m.attachment_url || m.image_url);
                        return (
                          <a href={imgSrc} target="_blank" rel="noreferrer" className="block">
                            <img src={imgSrc} alt="attachment"
                              className="max-w-full rounded-lg max-h-48 object-contain cursor-zoom-in"
                              onError={(e) => { e.target.style.display = 'none'; }} />
                            {m.body && <p className="mt-1 text-sm">{m.body}</p>}
                          </a>
                        );
                      })() : <p>{m.body || m.message}</p>}
                      <p className="text-[10px] text-right mt-1 opacity-35">{fmtTime(m.created_at)}</p>
                    </div>
                  </div>
                );
              })}
              {msgs.length === 0 && (
                <p className="text-center text-white/25 text-xs pt-10">No messages yet. Start the conversation.</p>
              )}
            </div>

            {/* Image preview */}
            {preview && (
              <div className="px-5 py-3 border-t border-[color:var(--ibo-border-solid)] flex items-center gap-3">
                <img src={preview} alt="preview" className="h-12 w-12 object-cover rounded-lg border border-[color:var(--ibo-border-solid)]" />
                <p className="text-xs text-white/45 flex-1">Ready to send</p>
                <button type="button" onClick={() => { setFile(null); setPreview(''); }} className="text-red-400/70 hover:text-red-400">
                  <X size={14} />
                </button>
              </div>
            )}

            {/* Message input */}
            {!isDone && (
              <form onSubmit={sendMsg} className="px-4 py-3 border-t border-[color:var(--ibo-border-solid)] flex items-center gap-2">
                <button type="button" onClick={() => fileRef.current?.click()}
                  className="flex items-center justify-center w-9 h-9 rounded-xl text-white/40 hover:text-[#5BB8FF] transition-colors"
                  style={{ border: '1px solid var(--ibo-border-solid)', background: 'var(--ibo-card)' }}>
                  <Upload size={14} />
                </button>
                <input type="file" ref={fileRef} className="hidden" accept="image/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (!f) return; setFile(f); setPreview(URL.createObjectURL(f)); }} />
                <input value={msgText} onChange={(e) => setMsgText(e.target.value)}
                  placeholder="Type a message…"
                  className="flex-1 rounded-xl bg-[color:var(--ibo-card)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2 text-sm text-[color:var(--ibo-ink)] placeholder:text-[color:var(--ibo-muted)] focus:outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors"
                />
                <button type="submit" disabled={ab('upload') || (!msgText.trim() && !file)}
                  className="flex items-center justify-center w-9 h-9 rounded-xl disabled:opacity-40 transition-all ibo-hover-scale"
                  style={{ background: 'linear-gradient(135deg,#0EA4AB,#5BB8FF)', boxShadow: '0 2px 12px rgba(14,164,171,0.3)' }}>
                  {ab('upload') ? <Loader2 size={14} className="animate-spin text-white" /> : <Send size={14} className="text-[#050a1a]" />}
                </button>
              </form>
            )}
          </div>

          {/* ── Order sidebar ────────────────────────────────────── */}
          <div className="space-y-4">

            {/* Order summary */}
            <div className="rounded-2xl border border-[color:var(--ibo-border-solid)] bg-[color:var(--ibo-card)] p-5 space-y-2.5">
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/35 mb-3">Order Summary</p>
              <SideRow label="Role" value={isBuyer ? `Buying ${order.asset}` : `Selling ${order.asset}`}
                valueClass={isBuyer ? 'text-green-400 font-bold' : 'text-red-400 font-bold'} />
              <SideRow label="Crypto" value={`${Number(order.crypto_amount).toFixed(6)} ${order.asset}`} />
              <SideRow label="Fiat"   value={`₹${Number(order.fiat_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`} accent />
              <SideRow label="Price"  value={`₹${Number(order.price).toLocaleString('en-IN', { maximumFractionDigits: 2 })} / ${order.asset}`} />
              <div className="h-px bg-[var(--ibo-border-solid)] my-1" />
              <p className="text-[10px] font-bold uppercase tracking-widest text-white/35 mt-3 mb-2">Payment Info</p>
              <SideRow label="Method"  value={pm.type || '—'} />
              {pm.upi_id         && <SideRow label="UPI ID"   value={pm.upi_id} mono />}
              {pm.holder_name    && <SideRow label="Holder"   value={pm.holder_name} />}
              {pm.bank_name      && <SideRow label="Bank"     value={pm.bank_name} />}
              {pm.account_number && <SideRow label="Account"  value={`****${pm.account_number.slice(-4)}`} mono />}
              {pm.ifsc           && <SideRow label="IFSC"     value={pm.ifsc} mono />}
              <div className="h-px bg-[var(--ibo-border-solid)] my-1" />
              <SideRow label="Deadline" value={order.payment_deadline ? fmtTime(order.payment_deadline) : '—'} />
              {order.payment_deadline && <CountdownTimer deadline={order.payment_deadline} />}
            </div>

            {/* Buyer action — mark paid */}
            {canMarkPaid && (
              <div className="rounded-2xl p-5 space-y-3"
                style={{ background: 'rgba(197,227,91,0.06)', border: '1px solid rgba(197,227,91,0.2)' }}>
                <div className="flex items-center gap-2 text-gold font-bold text-sm">
                  <Clock size={14} /> Waiting for your payment
                </div>
                <p className="text-xs text-white/65 leading-relaxed">
                  Send <strong className="text-white">₹{Number(order.fiat_amount).toLocaleString('en-IN', { maximumFractionDigits: 2 })}</strong> via <strong className="text-white">{pm.type}</strong> to the details above, then confirm below.
                </p>
                <div className="space-y-1.5">
                  <label className="block text-[10px] font-bold uppercase tracking-widest text-white/35">
                    UTR / Reference No. <span className="normal-case font-normal text-white/25">(optional)</span>
                  </label>
                  <input
                    type="text"
                    value={payNote}
                    onChange={(e) => setPayNote(e.target.value)}
                    placeholder="e.g. UTR123456789 or transaction ID"
                    className="w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-[color:var(--ibo-ink)] text-sm placeholder:text-[color:var(--ibo-muted)] focus:outline-none focus:border-[rgba(91,184,255,0.55)] transition-colors"
                  />
                </div>
                <button onClick={markPaid} disabled={ab('pay')}
                  className="ibo-hover-scale w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 inline-flex items-center justify-center gap-2"
                  style={{ background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80' }}>
                  {ab('pay') ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  I've Sent the Payment
                </button>
                <p className="text-[10px] text-white/30 text-center">
                  Upload your payment screenshot in the chat above for faster verification.
                </p>
              </div>
            )}

            {/* Seller action — release */}
            {canRelease && (
              <div className="rounded-2xl p-5 space-y-3"
                style={{ background: 'rgba(14,164,171,0.06)', border: '1px solid rgba(14,164,171,0.2)' }}>
                <div className="flex items-center gap-2 text-[#5BB8FF] font-bold text-sm">
                  <Lock size={14} /> Buyer has marked payment sent
                </div>
                <p className="text-xs text-white/65">Verify in your bank app, then enter your 2FA code and release.</p>
                <input type="text" inputMode="numeric" maxLength={6}
                  value={totpCode} onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="2FA code (6 digits)"
                  className="w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-white text-center tracking-widest font-mono text-base focus:outline-none focus:border-[rgba(91,184,255,0.55)]"
                />
                <button onClick={release} disabled={ab('release') || totpCode.length < 6}
                  className="ibo-hover-scale w-full py-3 rounded-xl text-sm font-bold transition-all disabled:opacity-40 inline-flex items-center justify-center gap-2"
                  style={{ background: 'rgba(14,164,171,0.15)', border: '1px solid rgba(14,164,171,0.3)', color: '#5BB8FF' }}>
                  {ab('release') ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle2 size={14} />}
                  Release Crypto
                </button>
              </div>
            )}

            {/* Buyer waiting info */}
            {isBuyer && order.status === 'paid_marked' && (
              <div className="flex items-start gap-3 rounded-2xl p-4"
                style={{ background: 'rgba(14,164,171,0.05)', border: '1px solid rgba(14,164,171,0.15)' }}>
                <Info size={13} className="text-[#5BB8FF] shrink-0 mt-0.5" />
                <p className="text-xs text-white/65 leading-relaxed">
                  Payment marked. Seller is verifying. If they don't respond within the payment window, raise a dispute.
                </p>
              </div>
            )}

            {/* Cancel */}
            {canCancel && (
              <button onClick={cancel} disabled={ab('cancel')}
                className="w-full py-2.5 rounded-xl border border-[color:var(--ibo-border-solid)] text-white/50 text-sm font-semibold hover:bg-[color:var(--ibo-hover)] hover:text-white/80 transition-colors disabled:opacity-40 inline-flex items-center justify-center gap-2">
                {ab('cancel') ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                Cancel Order
              </button>
            )}

            {/* Dispute */}
            {canDispute && (
              <button onClick={() => setShowDispute(true)}
                className="w-full py-2.5 rounded-xl text-sm font-semibold transition-colors inline-flex items-center justify-center gap-2"
                style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171' }}>
                <Flag size={13} /> Raise Dispute
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── Dispute modal ────────────────────────────────────────── */}
      {showDispute && (
        <P2PModal title={<span className="flex items-center gap-2"><Flag size={14} className="text-red-400" />Raise a Dispute</span>}
          onClose={() => setShowDispute(false)}>
          <P2PModal.Body>
            <div className="flex items-start gap-3 rounded-xl p-3.5"
              style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
              <AlertCircle size={14} className="text-red-400 shrink-0 mt-0.5" />
              <p className="text-xs text-white/70 leading-relaxed">Only raise a dispute for genuine payment issues. False disputes may result in account action.</p>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">Dispute Reason *</label>
              <select value={disputeReason} onChange={(e) => setDisputeReason(e.target.value)}
                className="w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-sm text-[color:var(--ibo-ink)] focus:outline-none focus:border-[rgba(91,184,255,0.55)]">
                <option value="">— Select a reason —</option>
                <option value="buyer_no_payment">Buyer hasn't sent payment</option>
                <option value="seller_no_release">Seller not releasing after payment</option>
                <option value="wrong_amount">Wrong amount sent/received</option>
                <option value="fake_proof">Fake payment proof submitted</option>
                <option value="chargeback">Payment reversed / chargeback</option>
                <option value="other">Other issue</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-[10px] font-bold uppercase tracking-widest text-white/40">
                Description * <span className="normal-case font-normal text-white/25">(min 10 chars)</span>
              </label>
              <textarea rows={3} value={disputeEvidence} onChange={(e) => setDisputeEvidence(e.target.value)}
                placeholder="Describe the issue — include UTR, amount, timestamp, screenshots…"
                className="w-full rounded-xl bg-[color:var(--ibo-elevated)] border border-[color:var(--ibo-border-solid)] px-3.5 py-2.5 text-sm text-[color:var(--ibo-ink)] placeholder:text-[color:var(--ibo-muted)] resize-none focus:outline-none focus:border-[rgba(91,184,255,0.55)]"
              />
              <p className={`text-xs font-mono ${disputeEvidence.length >= 10 ? 'text-green-400' : 'text-white/30'}`}>
                {disputeEvidence.length}/10 min characters
              </p>
            </div>
          </P2PModal.Body>
          <P2PModal.Footer>
            <button type="button" onClick={() => setShowDispute(false)}
              className="px-4 py-2 rounded-xl text-sm font-semibold text-white/55 hover:text-white transition-colors"
              style={{ border: '1px solid var(--ibo-border-solid)', background: 'transparent' }}>
              Cancel
            </button>
            <button type="button" onClick={submitDispute}
              disabled={ab('dispute') || !disputeReason || disputeEvidence.length < 10}
              className="ibo-hover-scale inline-flex items-center gap-2 px-5 py-2 rounded-xl text-sm font-bold disabled:opacity-40 transition-all"
              style={{ background: 'rgba(239,68,68,0.18)', border: '1px solid rgba(239,68,68,0.35)', color: '#f87171' }}>
              {ab('dispute') && <Loader2 size={13} className="animate-spin" />}Submit Dispute
            </button>
          </P2PModal.Footer>
        </P2PModal>
      )}
    </div>
  );
}

function SideRow({ label, value, mono, accent, valueClass }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="text-xs text-white/35 shrink-0">{label}</span>
      <span className={`text-xs font-semibold text-right truncate ${mono ? 'font-mono' : ''} ${valueClass || (accent ? 'text-[#5BB8FF]' : 'text-white/80')}`}>
        {value}
      </span>
    </div>
  );
}

function CountdownTimer({ deadline }) {
  const [left, setLeft] = useState('');
  useEffect(() => {
    const tick = () => {
      const diff = new Date(deadline) - new Date();
      if (diff <= 0) { setLeft('Expired'); return; }
      const m = Math.floor(diff / 60000);
      const s = Math.floor((diff % 60000) / 1000);
      setLeft(`${m}m ${s}s remaining`);
    };
    tick();
    const iv = setInterval(tick, 1000);
    return () => clearInterval(iv);
  }, [deadline]);
  if (!left) return null;
  return (
    <div className={`flex items-center gap-1.5 text-xs font-mono font-bold mt-1 ${left === 'Expired' ? 'text-red-400' : 'text-[#5BB8FF]'}`}>
      <Clock size={11} />{left}
    </div>
  );
}
