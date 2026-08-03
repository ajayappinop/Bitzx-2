/**
 * Isolated spot trade form column — order-book ticks must not re-render this tree.
 */
import React from 'react';
import TradeForm from './TradeForm';

type Props = {
  symbol: string;
  priceSeed?: string;
  quoteLoading?: boolean;
  onOrderPlaced?: () => void;
  onLockParentScroll?: (locked: boolean) => void;
  initialSide?: 'buy' | 'sell';
};

function TradeFormTerminal({
  symbol,
  priceSeed,
  quoteLoading,
  onOrderPlaced,
  onLockParentScroll,
  initialSide,
}: Props) {
  return (
    <TradeForm
      symbol={symbol}
      priceSeed={priceSeed}
      variant="terminal"
      quoteLoading={quoteLoading}
      onOrderPlaced={onOrderPlaced}
      onLockParentScroll={onLockParentScroll}
      initialSide={initialSide}
    />
  );
}

export default React.memo(TradeFormTerminal);
