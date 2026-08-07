/**
 * RWA (Real World Assets) perpetuals — Delta parity.
 * @see https://www.delta.exchange/app/futures/trade/XAUT/XAUTUSD?type=rwa
 *
 * Isolated from crypto futures: separate route, catalog filter (asset_class=rwa),
 * and Binance index feed so XAUT never pollutes BTC/ETH markets data.
 */
import FuturesTradePage from '@/pages/FuturesTradePage';

const RWA_DEFAULT = 'XAUTUSDT-PERP';

export default function RwaFuturesTradePage() {
  return (
    <FuturesTradePage
      assetClass="rwa"
      basePath="/rwa"
      defaultSymbol={RWA_DEFAULT}
      productLabel="RWA"
    />
  );
}
