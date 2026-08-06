/**
 * Delta-style options chain:
 * - Strike fixed in the center (no horizontal scroll).
 * - Calls / Puts occupy half the remaining width and H-scroll within that viewport.
 * - H-scrollbar sits at the bottom of the visible pane (not under all strike rows).
 * - Vertical scroll is synced across calls | strike | puts.
 * - H-scroll is mirrored so the same field is the same distance from Strike.
 */
import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import OptionsChainArm, { OptionsChainHeaders } from './OptionsChainArm';
import { expandCallCells } from './optionsChainColumns';

const COL_W = 70;
const STRIKE_W = 84;

function armWidthPx(cols) {
  const n = expandCallCells(cols).length;
  /* Exact pixel width for all visible columns — must exceed half-pane so overflow-x works */
  return Math.max(n * COL_W, COL_W * 8);
}

function maxScrollLeft(el) {
  if (!el) return 0;
  return Math.max(0, el.scrollWidth - el.clientWidth);
}

export default function DeltaSplitChainTable({
  expiryKey,
  rows,
  cols,
  selectedId,
  referencePrice,
  positions,
  onPick,
  maxOi = 1,
  atmStrike = null,
  fmtStrike,
}) {
  const callsHeadRef = useRef(null);
  const putsHeadRef = useRef(null);
  const callsBodyRef = useRef(null);
  const putsBodyRef = useRef(null);
  const strikeBodyRef = useRef(null);
  const syncing = useRef(false);
  const armW = armWidthPx(cols);

  const setX = (els, left) => {
    for (const el of els) {
      if (el && Math.abs(el.scrollLeft - left) > 0.5) el.scrollLeft = left;
    }
  };

  const setY = (els, top) => {
    for (const el of els) {
      if (el && Math.abs(el.scrollTop - top) > 0.5) el.scrollTop = top;
    }
  };

  /** Keep put/call distance-from-strike matched; keep head X = body X. */
  const applyCallsX = useCallback((scrollLeft) => {
    const cBody = callsBodyRef.current;
    const cHead = callsHeadRef.current;
    const pBody = putsBodyRef.current;
    const pHead = putsHeadRef.current;
    setX([cBody, cHead], scrollLeft);
    if (!cBody || !pBody) return;
    const maxC = maxScrollLeft(cBody);
    const fromStrike = maxC - scrollLeft;
    const putLeft = Math.min(maxScrollLeft(pBody), Math.max(0, fromStrike));
    setX([pBody, pHead], putLeft);
  }, []);

  const applyPutsX = useCallback((scrollLeft) => {
    const cBody = callsBodyRef.current;
    const cHead = callsHeadRef.current;
    const pBody = putsBodyRef.current;
    const pHead = putsHeadRef.current;
    setX([pBody, pHead], scrollLeft);
    if (!cBody || !pBody) return;
    const maxC = maxScrollLeft(cBody);
    const callLeft = Math.min(maxC, Math.max(0, maxC - scrollLeft));
    setX([cBody, cHead], callLeft);
  }, []);

  const applyY = useCallback((scrollTop) => {
    setY([callsBodyRef.current, putsBodyRef.current, strikeBodyRef.current], scrollTop);
  }, []);

  const onCallsBodyScroll = useCallback((e) => {
    if (syncing.current) return;
    syncing.current = true;
    applyCallsX(e.currentTarget.scrollLeft);
    applyY(e.currentTarget.scrollTop);
    requestAnimationFrame(() => { syncing.current = false; });
  }, [applyCallsX, applyY]);

  const onPutsBodyScroll = useCallback((e) => {
    if (syncing.current) return;
    syncing.current = true;
    applyPutsX(e.currentTarget.scrollLeft);
    applyY(e.currentTarget.scrollTop);
    requestAnimationFrame(() => { syncing.current = false; });
  }, [applyPutsX, applyY]);

  const onStrikeBodyScroll = useCallback((e) => {
    if (syncing.current) return;
    syncing.current = true;
    applyY(e.currentTarget.scrollTop);
    requestAnimationFrame(() => { syncing.current = false; });
  }, [applyY]);

  const onCallsHeadScroll = useCallback((e) => {
    if (syncing.current) return;
    syncing.current = true;
    applyCallsX(e.currentTarget.scrollLeft);
    requestAnimationFrame(() => { syncing.current = false; });
  }, [applyCallsX]);

  const onPutsHeadScroll = useCallback((e) => {
    if (syncing.current) return;
    syncing.current = true;
    applyPutsX(e.currentTarget.scrollLeft);
    requestAnimationFrame(() => { syncing.current = false; });
  }, [applyPutsX]);

  /** Default: columns nearest Strike (calls scrolled fully right, puts at 0). */
  const resetNearStrike = useCallback(() => {
    const cBody = callsBodyRef.current;
    if (!cBody) return;
    syncing.current = true;
    applyCallsX(maxScrollLeft(cBody));
    requestAnimationFrame(() => { syncing.current = false; });
  }, [applyCallsX]);

  useLayoutEffect(() => {
    resetNearStrike();
    const t1 = window.setTimeout(resetNearStrike, 40);
    const t2 = window.setTimeout(resetNearStrike, 180);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
    };
  }, [expiryKey, armW, rows.length, resetNearStrike]);

  useEffect(() => {
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(() => {
      if (syncing.current) return;
      const cBody = callsBodyRef.current;
      if (!cBody) return;
      const maxC = maxScrollLeft(cBody);
      if (maxC <= 1 || cBody.scrollLeft >= maxC - 2) resetNearStrike();
      else {
        syncing.current = true;
        applyCallsX(cBody.scrollLeft);
        requestAnimationFrame(() => { syncing.current = false; });
      }
    });
    [callsBodyRef, putsBodyRef, callsHeadRef, putsHeadRef].forEach((r) => {
      if (r.current) ro.observe(r.current);
    });
    return () => ro.disconnect();
  }, [armW, rows.length, resetNearStrike, applyCallsX]);

  const Th = ({ children, title: tip = '' }) => (
    <th title={tip} className="doc-th">{children}</th>
  );
  const fmt = fmtStrike || ((n) => String(n));

  const armStyle = { width: armW, minWidth: armW, tableLayout: 'fixed' };
  const strikeStyle = { width: STRIKE_W, minWidth: STRIKE_W, tableLayout: 'fixed' };

  return (
    <div className="doc-chain-split" role="region" aria-label="Options chain">
      {/* Header row — H-scroll only, locked height */}
      <div className="doc-chain-split__head">
        <div
          ref={callsHeadRef}
          className="doc-chain-split__pane doc-chain-split__pane--calls doc-chain-split__pane--head"
          onScroll={onCallsHeadScroll}
        >
          <table className="doc-chain-table doc-chain-table--arm" style={armStyle}>
            <thead>
              <tr>
                <OptionsChainHeaders side="call" cols={cols} Th={Th} />
              </tr>
            </thead>
          </table>
        </div>
        <div
          className="doc-chain-split__pane doc-chain-split__pane--strike doc-chain-split__pane--head"
          style={{ width: STRIKE_W, minWidth: STRIKE_W, maxWidth: STRIKE_W }}
        >
          <table className="doc-chain-table doc-chain-table--strike" style={strikeStyle}>
            <thead>
              <tr>
                <th className="doc-th doc-th-strike">Strike</th>
              </tr>
            </thead>
          </table>
        </div>
        <div
          ref={putsHeadRef}
          className="doc-chain-split__pane doc-chain-split__pane--puts doc-chain-split__pane--head"
          onScroll={onPutsHeadScroll}
        >
          <table className="doc-chain-table doc-chain-table--arm" style={armStyle}>
            <thead>
              <tr>
                <OptionsChainHeaders side="put" cols={cols} Th={Th} />
              </tr>
            </thead>
          </table>
        </div>
      </div>

      {/* Body — bounded height so H-scrollbar stays on-screen at pane bottom */}
      <div className="doc-chain-split__body">
        <div
          ref={callsBodyRef}
          className="doc-chain-split__pane doc-chain-split__pane--calls"
          onScroll={onCallsBodyScroll}
        >
          <table className="doc-chain-table doc-chain-table--arm" style={armStyle}>
            <tbody className="doc-chain-body">
              {rows.map((row) => {
                const callId = row.call?.id;
                const putId = row.put?.id;
                const rowSel = selectedId && (selectedId === callId || selectedId === putId);
                return (
                  <tr key={`${expiryKey}-c-${row.strike}`} className={rowSel ? 'doc-row--sel' : ''}>
                    <OptionsChainArm
                      contract={row.call}
                      side="call"
                      selectedId={selectedId}
                      referencePrice={referencePrice}
                      positions={positions}
                      onPick={onPick}
                      cols={cols}
                      maxOi={maxOi}
                      rowSelected={rowSel}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div
          ref={strikeBodyRef}
          className="doc-chain-split__pane doc-chain-split__pane--strike"
          style={{ width: STRIKE_W, minWidth: STRIKE_W, maxWidth: STRIKE_W }}
          onScroll={onStrikeBodyScroll}
        >
          <table className="doc-chain-table doc-chain-table--strike" style={strikeStyle}>
            <tbody className="doc-chain-body">
              {rows.map((row) => {
                const isAtm = atmStrike != null && row.strike === atmStrike;
                const callId = row.call?.id;
                const putId = row.put?.id;
                const rowSel = selectedId && (selectedId === callId || selectedId === putId);
                return (
                  <tr key={`${expiryKey}-s-${row.strike}`} className={rowSel ? 'doc-row--sel' : ''}>
                    <td className={`doc-strike ${isAtm ? 'doc-strike--atm' : ''}`}>
                      <span className="doc-strike__val">{fmt(Number(row.strike))}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div
          ref={putsBodyRef}
          className="doc-chain-split__pane doc-chain-split__pane--puts"
          onScroll={onPutsBodyScroll}
        >
          <table className="doc-chain-table doc-chain-table--arm" style={armStyle}>
            <tbody className="doc-chain-body">
              {rows.map((row) => {
                const callId = row.call?.id;
                const putId = row.put?.id;
                const rowSel = selectedId && (selectedId === callId || selectedId === putId);
                return (
                  <tr key={`${expiryKey}-p-${row.strike}`} className={rowSel ? 'doc-row--sel' : ''}>
                    <OptionsChainArm
                      contract={row.put}
                      side="put"
                      selectedId={selectedId}
                      referencePrice={referencePrice}
                      positions={positions}
                      onPick={onPick}
                      cols={cols}
                      maxOi={maxOi}
                      rowSelected={rowSel}
                    />
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
