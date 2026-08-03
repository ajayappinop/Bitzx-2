/**
 * Memoized slider shell — isolates from parent order-book / ticker re-renders.
 */
import React from 'react';
import TerminalPctSlider from './TerminalPctSlider';

type Props = {
  resetKey?: string;
  onLiveChange?: (pct: number) => void;
  onChange: (pct: number) => void;
  side?: 'buy' | 'sell';
  size?: 'default' | 'large';
  hidePctInput?: boolean;
  syncPct?: number;
  onLockParentScroll?: (locked: boolean) => void;
};

function StableTerminalPctSlider({
  resetKey,
  onLiveChange,
  onChange,
  side,
  size,
  hidePctInput,
  syncPct,
  onLockParentScroll,
}: Props) {
  return (
    <TerminalPctSlider
      resetKey={resetKey}
      onLiveChange={onLiveChange}
      onChange={onChange}
      side={side}
      size={size}
      hidePctInput={hidePctInput}
      syncPct={syncPct}
      onLockParentScroll={onLockParentScroll}
    />
  );
}

function propsEqual(prev: Props, next: Props): boolean {
  return (
    prev.resetKey === next.resetKey
    && prev.side === next.side
    && prev.size === next.size
    && prev.hidePctInput === next.hidePctInput
    && prev.syncPct === next.syncPct
    && prev.onChange === next.onChange
    && prev.onLiveChange === next.onLiveChange
    && prev.onLockParentScroll === next.onLockParentScroll
  );
}

export default React.memo(StableTerminalPctSlider, propsEqual);
