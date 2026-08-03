/**
 * Dun & Bradstreet DUNS Registered Seal — embed code from D&B (do not change src URL).
 */
export default function DunsRegisteredSeal({ className = '' }) {
  return (
    <div
      className={`inline-flex shrink-0 items-center justify-center rounded-lg bg-white p-4 shadow-[0_4px_16px_rgba(0,0,0,0.35)] ring-1 ring-white/20 ${className}`}
      aria-label="D&B DUNS Registered Seal"
    >
      <iframe
        id="Iframe1"
        src="https://dunsregistered.dnb.com/SealAuthentication.aspx?Cid=1"
        width="114"
        height="97"
        frameBorder="0"
        scrolling="no"
        allowTransparency={true}
        title="D&B DUNS Registered Seal"
        className="block h-[97px] w-[114px] max-w-full border-0 bg-white"
      />
    </div>
  );
}
