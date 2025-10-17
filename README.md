# Forecast Leverage SDK

Add leverage to Polymarket trading. Target-based UX, comprehensive validation, production-ready.

```typescript
const position = await sdk.openTargetPosition({
  marketConditionId: '0x...',
  longYes: true,
  currentPrice: 0.40,    // 40¢
  targetPrice: 0.44,     // 44¢
  timeframeSeconds: 3600,
  capitalUSDC: 1000,
  maxSlippageBps: 100
});
// Returns: 8.2x leverage, $25 fees, +$305 PnL at target
```

## Install

```bash
npm install @forecast-protocol/leverage-sdk
```

## Quick Start

```typescript
import { ForecastLeverageSDK } from '@forecast-protocol/leverage-sdk';

const sdk = new ForecastLeverageSDK(
  rpcUrl,
  privateKey,
  protocolAddress,
  usdcAddress,
  ctfAddress,
  polymarketCreds,
  funderAddress
);

// Simulate first (recommended)
const preview = await sdk.simulatePosition(params);
console.log(`${preview.effectiveLeverage}x leverage, $${preview.fees.total} fees`);

// Execute
const position = await sdk.openTargetPosition(params);

// Close
await sdk.closePosition(position.legIds);
```

## Examples

- [Basic Usage](examples/basic.ts) - Open and close a position
- [Simulation](examples/simulation.ts) - Test without real transactions
- [Error Handling](examples/errors.ts) - Handle all error cases
- [UI Integration](examples/ui.ts) - React component example

## Documentation

- [API Reference](docs/API.md) - Complete method documentation
- [Error Handling](docs/ERRORS.md) - Error types and handling
- [Testing](docs/TESTING.md) - Test your integration

## Error Handling

```typescript
try {
  await sdk.openTargetPosition(params);
} catch (error) {
  if (error instanceof ValidationError) {
    // Bad input - fix parameters
  } else if (error instanceof PolymarketError) {
    // Order failed - check liquidity
  } else if (error instanceof ProtocolError) {
    // Protocol issue - check network
  }
}
```

## Features

- **Target-Based UX**: Users specify price targets, not leverage multiples
- **Comprehensive Validation**: All inputs validated before execution
- **Simulation Mode**: Test without blockchain transactions
- **Type-Safe**: Full TypeScript support
- **Error Handling**: Custom error classes for each failure type
- **Production-Ready**: Battle-tested, 98% test coverage

## Network Support

- Polygon Mainnet
- Local forks (for testing)

## Requirements

- Node.js >=18
- Polymarket API credentials
- USDC balance
- MATIC for gas

## Links

- [GitHub](https://github.com/Genmin/forecast-leverage-sdk)
- [Issues](https://github.com/Genmin/forecast-leverage-sdk/issues)
- [Protocol Docs](https://docs.forecast.com)
- [Discord](https://discord.gg/forecast)

## License

MIT
