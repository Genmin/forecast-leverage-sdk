# Forecast Protocol SDK

TypeScript SDK for integrating leveraged prediction market trading via Forecast Protocol.

## Installation

```bash
npm install @forecast-protocol/sdk
```

## Usage

```typescript
import { ForecastLeverageSDK } from '@forecast-protocol/sdk';

const sdk = new ForecastLeverageSDK(
  rpcUrl,
  privateKey,
  protocolAddress,
  usdcAddress,
  ctfAddress,
  polymarketFunderAddress
);

await sdk.setupPolymarket();

const position = await sdk.openTargetPosition({
  marketConditionId: '0x...',
  longYes: true,
  currentPrice: 0.40,
  targetPrice: 0.44,
  timeframeSeconds: 3600,
  capitalUSDC: 1000,
  maxSlippageBps: 100
});
```

## Documentation

See [INTEGRATION_GUIDE.md](./INTEGRATION_GUIDE.md) for complete integration instructions.

## Testing

```bash
npm test
```

## License

MIT
