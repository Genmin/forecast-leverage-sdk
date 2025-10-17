# API Reference

## Constructor

```typescript
new ForecastLeverageSDK(
  rpcUrl: string,
  privateKey: string,
  protocolAddress: string,
  usdcAddress: string,
  ctfAddress: string,
  polymarketApiCreds: any,
  polymarketFunderAddress: string
)
```

### Parameters

- `rpcUrl`: Polygon RPC endpoint
- `privateKey`: Wallet private key (0x...)
- `protocolAddress`: Forecast Protocol contract address
- `usdcAddress`: USDC token address (Polygon: `0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174`)
- `ctfAddress`: CTF token address (Polygon: `0x4D97DCd97eC945f40cF65F87097ACe5EA0476045`)
- `polymarketApiCreds`: Polymarket API credentials
- `polymarketFunderAddress`: Polymarket funder address

##Methods

### `simulatePosition(params)`

Estimate position without executing transactions. Use for testing and showing previews.

```typescript
const preview = await sdk.simulatePosition({
  marketConditionId: '0x...',
  longYes: true,
  currentPrice: 0.40,
  targetPrice: 0.44,
  timeframeSeconds: 3600,
  capitalUSDC: 1000,
  maxSlippageBps: 100
});
```

**Returns**: `LeveragePosition`

**Throws**: `ValidationError` if inputs invalid

### `openTargetPosition(params)`

Open leveraged position with real transactions.

```typescript
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

**Returns**: `LeveragePosition`

**Throws**:
- `ValidationError` - Invalid inputs
- `PolymarketError` - Order execution failed
- `ProtocolError` - Protocol interaction failed

### `closePosition(legIds)`

Close all legs of a position.

```typescript
const pnl = await sdk.closePosition(position.legIds);
// Returns: Total USDC received
```

**Returns**: `number` (USDC amount)

**Throws**: `ProtocolError` if close fails

## Types

### `TargetPositionParams`

```typescript
interface TargetPositionParams {
  marketConditionId: string;      // bytes32 hex string
  longYes: boolean;                // true = YES, false = NO
  currentPrice: number;            // 0-1 (0.40 = 40¢)
  targetPrice: number;             // 0-1 (0.44 = 44¢)
  timeframeSeconds: number;        // Duration in seconds
  capitalUSDC: number;             // Dollars (1000 = $1000)
  maxSlippageBps: number;          // Basis points (100 = 1%)
}
```

**Validation Rules**:
- `marketConditionId`: Must start with `0x`
- `currentPrice`, `targetPrice`: Must be 0-1
- Price direction: LONG YES requires `target > current`, LONG NO requires `target < current`
- `timeframeSeconds`: 60 seconds minimum, 1 year maximum
- `capitalUSDC`: $10 minimum
- `maxSlippageBps`: 0-5000 (0-50%)

### `LeveragePosition`

```typescript
interface LeveragePosition {
  legIds: bigint[];                // Protocol leg IDs
  totalExposure: number;           // Total token exposure
  effectiveLeverage: number;       // Actual leverage achieved
  capitalDeployed: number;         // USDC spent
  fees: {
    protocolSenior: number;
    protocolJunior: number;
    polymarketSlippage: number;
    gas: number;
    total: number;
  };
  pnl: {
    atTarget: number;              // PnL if target hit
    breakeven: number;             // Breakeven price
    maxProfit: number;             // Max profit (at $1.00)
    maxLoss: number;               // Max loss (at $0.00)
  };
  autoCloseTime: number;           // Unix timestamp
  F: number;                       // Capital efficiency
  R: number;                       // Total rate
}
```

## Errors

### `ValidationError`

Thrown when input parameters are invalid.

```typescript
try {
  await sdk.openTargetPosition(params);
} catch (error) {
  if (error instanceof ValidationError) {
    console.error('Invalid input:', error.message);
    // Fix parameters and retry
  }
}
```

### `PolymarketError`

Thrown when Polymarket order fails.

```typescript
catch (error) {
  if (error instanceof PolymarketError) {
    console.error('Order failed:', error.message);
    // Check liquidity, try different market, or reduce size
  }
}
```

### `ProtocolError`

Thrown when protocol interaction fails.

```typescript
catch (error) {
  if (error instanceof ProtocolError) {
    console.error('Protocol error:', error.message);
    // Check network, protocol status, or contact support
  }
}
```

## Common Patterns

### Preview Before Execute

```typescript
// Show user preview
const preview = await sdk.simulatePosition(params);
showUserPreview(preview);

// If user approves, execute
if (userApproves) {
  const position = await sdk.openTargetPosition(params);
}
```

### Position Management

```typescript
// Track position
const position = await sdk.openTargetPosition(params);
storePosition({
  legIds: position.legIds,
  autoCloseTime: position.autoCloseTime
});

// Monitor auto-close
setInterval(() => {
  if (Date.now() >= position.autoCloseTime) {
    sdk.closePosition(position.legIds);
  }
}, 60000);
```

### Error Recovery

```typescript
let retries = 0;
while (retries < 3) {
  try {
    return await sdk.openTargetPosition(params);
  } catch (error) {
    if (error instanceof PolymarketError && retries < 2) {
      retries++;
      await sleep(1000);
      continue;
    }
    throw error;
  }
}
```

## Notes

- Always use `simulatePosition()` before `openTargetPosition()` in production
- Store `legIds` - you'll need them to close
- Monitor `autoCloseTime` - positions close automatically at expiry
- FOK orders may fail with low liquidity - handle `PolymarketError`
- Gas estimation is approximate - actual costs may vary
