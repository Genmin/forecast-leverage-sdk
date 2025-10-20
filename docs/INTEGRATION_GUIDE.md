# Integration Guide

## Overview

Forecast Protocol provides leveraged trading for Polymarket prediction markets. The SDK implements an automated position opening mechanism that executes multiple transactions to achieve the desired leverage.

Users specify price targets and timeframes. The SDK calculates the required leverage and executes the position.

## Quick Start

```typescript
import { ForecastLeverageSDK } from "./ForecastLeverageSDK";

const sdk = new ForecastLeverageSDK(
  "https://polygon-rpc.com",
  privateKey,
  "0x...", // Protocol address
  "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC
  "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045", // CTF
  polymarketApiCreds,
  polymarketFunderAddress
);

const position = await sdk.openTargetPosition({
  marketConditionId: "0x...",
  longYes: true,
  currentPrice: 0.40,
  targetPrice: 0.44,
  timeframeSeconds: 3600,
  capitalUSDC: 1000,
  maxSlippageBps: 100,
});
```

## How It Works

### Architecture

```
User Input → SDK Calculates → Loop Execution → Position Created
  "40¢→44¢"     F, loops        buy→open→      Multi-leg
  "1 hour"      rates           repeat         tracked
```

### Execution Loop

1. Calculate Parameters
   - Query protocol for F (capital efficiency)
   - Calculate loops needed based on geometric series
   - Determine auto-close time

2. Execute Loop (N iterations)
   - Buy tokens on Polymarket (GTC order)
   - Wait for confirmation
   - Approve protocol
   - Call protocol.open()
   - Use borrowed USDC for next iteration

3. Return Position
   - All leg IDs
   - Total exposure
   - Effective leverage
   - Fee breakdown
   - PnL scenarios

### Key Concepts

Capital Efficiency (F):
```
F = 1 / (1 + R×T/365)
```
- Lower rates and shorter terms increase F
- Higher F allows more leverage per loop
- F determines USDC borrowed per token

Runway:
- Debt grows linearly: D(t) = F × (1 + R×t/365)
- At term T: D(T) = $1 per token
- Tokens worth max $1 (YES+NO=$1 guarantee)
- Auto-close when debt hits $1 or market resolves

Leverage:
- Each loop: lock tokens → borrow F×tokens in USDC → buy more tokens
- Geometric series: L = 1/(1-F)
- Example: F=0.84 → max leverage ≈ 6.25x

## Fee Structure

Total fees = protocol fees + slippage + gas

Protocol Fees:
```
Senior: F × sets × rS × (t/365)
Junior: F × sets × rJ × (t/365)
```

Slippage:
- Each loop buys tokens on Polymarket
- Market orders have slippage
- SDK calculates total across all loops

Gas:
- Approximately 500k gas per loop iteration
- Polygon gas costs are typically low

## Target-Based Parameters

The SDK accepts price targets instead of leverage multiples:

```typescript
interface TraderUI {
  currentPrice: number;    // Market current price
  targetPrice: number;     // User's target
  timeframe: number;       // Seconds to target
  capital: number;         // USDC to deploy
}
```

This approach:
- Matches user expectations (price movements)
- Constrains risk via timeframe selection
- Provides fee transparency
- Enables PnL scenario analysis

## Integration Steps

### 1. Setup

```bash
npm install @polymarket/clob-client ethers
```

### 2. Initialize SDK

```typescript
const sdk = new ForecastLeverageSDK(
  rpcUrl,
  privateKey,
  protocolAddress,
  usdcAddress,
  ctfAddress,
  await clobClient.createOrDeriveApiKey(),
  polymarketFunderAddress
);
```

### 3. Verify Market

Before trading, verify the market is registered:

```typescript
await protocolContract.verifyMarket(conditionId);
```

### 4. Open Position

```typescript
const position = await sdk.openTargetPosition({
  marketConditionId,
  longYes: true,
  currentPrice: 0.40,
  targetPrice: 0.44,
  timeframeSeconds: 3600,
  capitalUSDC: 1000,
  maxSlippageBps: 100,
});
```

### 5. Monitor Position

Track position value in real-time:

```typescript
const currentPrice = await getPolymarketPrice(tokenId);
const currentValue = position.totalExposure * currentPrice;
const pnl = currentValue - position.capitalDeployed - position.fees.total;
```

### 6. Close Position

```typescript
const usdcReturned = await sdk.closePosition(position.legIds);
const finalPnl = usdcReturned - position.capitalDeployed;
```

## Example UI Implementation

```tsx
function LeverageTrader({ market }) {
  const [target, setTarget] = useState({
    price: market.currentPrice * 1.1,
    timeframe: 3600,
    capital: 100,
  });

  const [quote, setQuote] = useState(null);

  useEffect(() => {
    sdk.calculateLeverageParams({
      marketConditionId: market.conditionId,
      longYes: true,
      currentPrice: market.currentPrice,
      targetPrice: target.price,
      timeframeSeconds: target.timeframe,
      capitalUSDC: target.capital,
    }).then(setQuote);
  }, [target]);

  return (
    <div>
      <h3>Bet on: {market.question}</h3>
      <p>Current: {market.currentPrice}</p>

      <input
        type="number"
        value={target.price}
        onChange={e => setTarget({...target, price: e.target.value})}
        label="Target Price"
      />

      <select
        value={target.timeframe}
        onChange={e => setTarget({...target, timeframe: e.target.value})}
      >
        <option value={3600}>1 hour</option>
        <option value={86400}>1 day</option>
        <option value={604800}>1 week</option>
      </select>

      <input
        type="number"
        value={target.capital}
        onChange={e => setTarget({...target, capital: e.target.value})}
        label="Capital (USDC)"
      />

      {quote && (
        <div className="quote">
          <p>Effective Leverage: {quote.maxLeverage.toFixed(2)}x</p>
          <p>Total Fees: ${quote.totalFees.toFixed(2)}</p>
          <p>PnL at Target: ${quote.pnlAtTarget.toFixed(2)}</p>
          <p>Breakeven: ${quote.breakeven.toFixed(3)}</p>
        </div>
      )}

      <button onClick={() => executePosition(target)}>
        Open Position
      </button>
    </div>
  );
}
```

## Important Notes

### Non-Atomic Execution

The leverage loop is not atomic. Each iteration requires:
1. Polymarket order (off-chain matching)
2. On-chain settlement
3. Protocol transaction

This process typically takes 10-30 seconds for 3-5 loops.

### Failure Handling

If a loop fails mid-execution:
- Already-opened legs remain open
- User can close them individually
- No funds are lost (non-custodial)

### Rate Limits

Polymarket API has rate limits:
- 1000 requests/hour for basic tier
- Upgrade for high-frequency trading

### Gas Optimization

- Batch approvals at initialization
- Use EIP-2612 permits where possible
- Consider gas price for profitability

## Advanced Features

### Custom Loop Strategy

Override default loop calculation:

```typescript
const position = await sdk.openTargetPosition({
  ...params,
  customLoops: 3, // Force exactly 3 loops
});
```

### Partial Close

Close some legs, keep others:

```typescript
await sdk.closePosition(position.legIds.slice(0, 2)); // Close first 2 legs
```

### Real-Time Updates

Subscribe to WebSocket for position updates:

```typescript
const ws = sdk.subscribeToPosition(position.legIds);
ws.on('priceUpdate', (price) => {
  // Update UI with current PnL
});
```

## Troubleshooting

"Order failed to fill"
- Increase maxSlippageBps
- Market might be illiquid
- Try smaller capital amount

"Insufficient senior liquidity"
- Protocol senior pool is at capacity
- Wait for liquidity or trade smaller

"Insufficient junior liquidity"
- Junior pool for this market is at capacity
- Consider other markets

"F did not converge"
- Rates are extremely high
- Try shorter timeframe

## Contract Addresses

Polygon Mainnet:
```
Protocol: TBD (deploy to mainnet)
USDC: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
CTF: 0x4D97DCd97eC945f40cF65F87097ACe5EA0476045
Polymarket Exchange: 0x4bFb41d5B3570DeFd03C39a9A4D8dE6Bd8B8982E
```

## Support

- Documentation: https://docs.forecast.protocol
- Discord: TBD
- GitHub: TBD
