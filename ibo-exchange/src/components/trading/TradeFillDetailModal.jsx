import { X, Copy, Check, ArrowRight } from 'lucide-react';


import { useState } from 'react';


import { Link } from 'react-router-dom';





function Row({ label, children, mono }) {


  return (


    <div className="flex flex-col sm:flex-row sm:items-start gap-1 sm:gap-4 py-3 border-b border-white/[.06] last:border-0">


      <span className="text-white/50 text-xs font-bold uppercase tracking-wider sm:w-40 shrink-0">{label}</span>


      <div className={`text-white text-sm flex-1 min-w-0 break-all ${mono ? 'font-mono' : ''}`}>{children}</div>


    </div>


  );


}





function CopyLine({ text }) {


  const [ok, setOk] = useState(false);


  if (!text) return <span className="text-white/40">—</span>;


  return (


    <span className="inline-flex items-center gap-2">


      <span className="font-mono text-xs sm:text-sm">{text}</span>


      <button


        type="button"


        onClick={() => { navigator.clipboard.writeText(text); setOk(true); setTimeout(() => setOk(false), 2000); }}


        className="p-1 rounded text-white/60 hover:text-[#FE9D55] transition-colors"


        aria-label="Copy"


      >


        {ok ? <Check size={14} className="text-green-400" /> : <Copy size={14} />}


      </button>


    </span>


  );


}





/**


 * Detail sheet for one fill from GET /api/orders/trades (UserTradeOut).


 */


export default function TradeFillDetailModal({ trade, onClose }) {


  if (!trade) return null;





  const notional = Number(trade.price) * Number(trade.amount);


  const rp = trade.realized_pnl != null ? Number(trade.realized_pnl) : null;


  const showPnl = String(trade.side || '').toLowerCase() === 'sell' && rp != null && !Number.isNaN(rp);


  const iso = trade.created_at


    ? new Date(trade.created_at).toLocaleString('en-US', {


        weekday: 'short',


        month: 'short',


        day: 'numeric',


        year: 'numeric',


        hour: '2-digit',


        minute: '2-digit',


        second: '2-digit',


        hour12: false,


      })


    : '—';





  return (


    <div


      className="fixed inset-0 z-[220] flex items-center justify-center p-4"


      style={{ background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)' }}


      role="dialog"


      aria-modal="true"


      aria-labelledby="fill-detail-title"


      onClick={onClose}


    >


      <div


        className="w-full max-w-lg rounded-2xl border border-white/[.08] shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"


        style={{ background: '#12141a' }}


        onClick={e => e.stopPropagation()}


      >


        <div className="flex items-center justify-between px-5 py-4 border-b border-white/[.06] sticky top-0 bg-[#12141a] z-10">


          <h2 id="fill-detail-title" className="text-lg font-extrabold text-white">


            Fill details


          </h2>


          <button


            type="button"


            onClick={onClose}


            className="p-2 rounded-lg text-white hover:bg-white/[.06] transition-colors"


            aria-label="Close"


          >


            <X size={20} />


          </button>


        </div>





        <div className="px-5 py-2">


          <Row label="Time">{iso}</Row>


          <Row label="Pair">


            <span className="font-bold">{trade.symbol?.replace('USDT', '/USDT')}</span>


          </Row>


          <Row label="Side">


            <span


              className={`inline-flex text-xs font-extrabold uppercase px-2.5 py-1 rounded-md ${


                trade.side === 'buy' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'


              }`}


            >


              {trade.side}


            </span>


          </Row>


          <Row label="Price (USDT)" mono>


            ${Number(trade.price).toLocaleString(undefined, { maximumFractionDigits: 8 })}


          </Row>


          <Row label="Amount (base)" mono>


            {Number(trade.amount).toLocaleString(undefined, { maximumFractionDigits: 8 })}


          </Row>


          <Row label="Notional (USDT)" mono>


            ${notional.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}


          </Row>


          <Row label="Fee">


            <span className="font-mono">


              {Number(trade.fee).toLocaleString(undefined, { maximumFractionDigits: 8 })} {trade.fee_asset}


            </span>


          </Row>


          <Row label="Liquidity Source">


            <span className="inline-flex text-xs font-extrabold uppercase px-2.5 py-1 rounded-md bg-blue-500/15 text-blue-300">


              {String(trade.liquidity_source || 'USER')}


            </span>


          </Row>


          <Row label="Realized P&amp;L (USDT)">


            {showPnl ? (


              <span className={`font-mono font-bold ${rp >= 0 ? 'text-green-400' : 'text-red-400'}`}>


                {rp >= 0 ? '+' : ''}${rp.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}


              </span>


            ) : (


              <span className="text-white/50 text-sm">


                Shown on sell fills only (average-cost vs. proceeds).


              </span>


            )}


          </Row>


          <Row label="Fill ID">


            <CopyLine text={trade.id} />


          </Row>


          <Row label="Order ID">


            <CopyLine text={trade.order_id} />


          </Row>


        </div>





        <div className="px-5 py-4 border-t border-white/[.06] flex flex-wrap gap-3">


          <Link


            to={`/futures/BTCUSDT-PERP`}


            onClick={onClose}


            className="inline-flex items-center gap-2 text-sm font-bold text-[#FE9D55] hover:underline"


          >


            Open pair in terminal <ArrowRight size={14} />


          </Link>


        </div>


      </div>


    </div>


  );


}


