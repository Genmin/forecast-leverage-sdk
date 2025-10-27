# Integrator FAQ

## Overview

This document addresses common integration questions for the Forecast Protocol Leverage SDK. Answers are based on SDK version 2.0 and reference only public interfaces.

## Questions

### 1. Signer Compatibility: Can we use Privy embedded wallets instead of private keys?

The SDK accepts either private key strings or ethers.Signer objects in the constructor. For Privy integration:

```typescript
const privyProvider = await wallet.getEthereumProvider();
const ethersProvider = new ethers.BrowserProvider(privyProvider);
const signer = await ethersProvider.getSigner();

const sdk = new ForecastLeverageSDK(
  rpcUrl,
  signer,  // Pass signer directly
  protocolAddress,
  usdcAddress,
  ctfAddress,
  polymarketFunderAddress
);
```

The SDK internally converts v6 signers to v5 format for Polymarket CLOB client compatibility. This conversion extracts the private key using standard ethers interfaces (privateKey, signingKey properties).

If your Privy configuration restricts private key access, you will receive an error message with instructions to adjust permissions or export the key manually.

### 2. Order Types: Do you support FOK or IOC orders? Is there auto-retry?

The SDK supports three order execution modes:

**FOK (Fill or Kill)**: Attempts immediate execution with slippage protection. If unfilled within 10 seconds, the order is cancelled and retried up to 3 times (configurable) with exponential backoff.

**GTC (Good Till Cancelled)**: Places a limit order with a 30 second fill window. Allows for better price execution at the cost of slower fills.

**GTD (Good Till Date)**: Similar to GTC with time-based expiration.

Configuration example:

```typescript
const position = await sdk.openTargetPosition({
  marketConditionId: '0x...',
  longYes: true,
  currentPrice: 0.40,
  targetPrice: 0.44,
  timeframeSeconds: 3600,
  capitalUSDC: 1000,
  maxSlippageBps: 100,
  orderType: 'FOK',     // Optional, defaults to FOK
  maxRetries: 3,        // Optional, defaults to 3
  retryDelayMs: 2000    // Optional, defaults to 2000ms
});
```

Auto-retry behavior:
1. Order placed on Polymarket
2. SDK polls for fill status every 1 second
3. If timeout reached, order is cancelled
4. Retry with updated orderbook price and exponential backoff (1.5x multiplier per attempt)
5. Non-retryable errors (no liquidity, invalid price) throw immediately

### 3. Leverage Control: Can we specify fixed leverage or cap the loops?

The SDK does not enforce hard leverage caps. Leverage is determined by:
1. Protocol capital efficiency factor (F) based on current utilization
2. Available liquidity in senior and junior pools
3. Number of loop iterations calculated from F

The loop count formula is `ceil(-ln(0.01) / ln(F))`, which calculates iterations needed to reach 99% of theoretical maximum leverage `1/(1-F)`.

To implement custom leverage limits:

**Frontend approach** (recommended):
```typescript
const simulation = await sdk.simulatePosition(params);
if (simulation.effectiveLeverage > MAX_LEVERAGE) {
  // Reject or adjust parameters
  throw new Error(`Leverage ${simulation.effectiveLeverage}x exceeds limit`);
}
```

**SDK wrapper approach**:
```typescript
class LeverageCapSDK extends ForecastLeverageSDK {
  async openTargetPosition(params: TargetPositionParams, maxLeverage: number): Promise<LeveragePosition> {
    const sim = await this.simulatePosition(params);
    if (sim.effectiveLeverage > maxLeverage) {
      // Reduce capital or adjust timeframe
      params.capitalUSDC = params.capitalUSDC * (maxLeverage / sim.effectiveLeverage);
    }
    return super.openTargetPosition(params);
  }
}
```

Protocol-level limits are based on available liquidity only. No fixed caps are encoded in the SDK or contracts.

### 4. Settlement: What is the payout waterfall on close, expiry, and liquidation?

Position closing follows this sequence:

**Manual close (before expiry)**:
User calls `closePosition(legIds)` which triggers `protocol.close()` for each leg. The protocol:
1. Transfers CTF tokens from borrower back to protocol
2. Returns long position tokens to borrower
3. Refunds borrowed USDC plus interest to pools

**Auto-close (at or after expiry)**:
When term expires or market resolves, anyone can trigger close. The protocol:
1. Redeems CTF token pairs (YES + NO) for USDC at Polymarket CTF contract
2. Distributes USDC to lenders based on pre-calculated interest rates
3. Returns any surplus to borrower
4. Emits LegClosed event with boolean flag indicating auto-close path

**Payout priority**:
Senior pool receives principal plus interest first. Junior pool receives remaining amount. This structure is enforced at the protocol level via the quote() function which calculates rates ensuring senior coverage.

**Event emission**:
```solidity
event LegClosed(uint256 indexed legId, bool autoClose);
```

Principal and interest amounts are NOT emitted in events. Calculate them off-chain using:
```typescript
const leg = await protocol.legs(legId);
const seniorInterest = (leg.sets * leg.F_e18 * leg.rS_e18 * leg.term) / (365 * 24 * 3600 * 1e36);
const juniorInterest = (leg.sets * leg.F_e18 * leg.rJ_e18 * leg.term) / (365 * 24 * 3600 * 1e36);
```

### 5. Lender Pools: Are they protocol-managed or can users deposit?

Both senior and junior pools are open for user deposits.

**Senior pool** (USDC):
Implemented as ERC4626 vault. Users deposit USDC and receive fUSDC shares representing proportional pool ownership. Standard vault interface:
```typescript
protocol.deposit(usdcAmount, receiverAddress);
protocol.withdraw(usdcAmount, receiverAddress, ownerAddress);
protocol.redeem(shareAmount, receiverAddress, ownerAddress);
```

**Junior pools** (CTF tokens):
Per-market staking pools. Users deposit YES or NO tokens from specific Polymarket markets:
```typescript
protocol.verifyMarket(conditionId);  // One-time setup per market
protocol.depositJunior(positionId, amount);
protocol.withdrawJunior(positionId, amount);
protocol.claimJuniorRewards(positionId);
```

Junior lenders earn yield when borrowers repay loans. Rewards are distributed as fUSDC vault shares.

For integration, use these contract methods directly. The SDK focuses on the borrower experience and does not wrap lender functionality.

### 6. Market Eligibility: What criteria determine which markets are eligible?

The `verifyMarket(conditionId)` function validates:

1. Market must be binary (exactly 2 outcomes)
2. Market must not be previously verified
3. Market must be unresolved (payout numerators both zero)
4. Market must exist in Polymarket CTF contract

No liquidity, volatility, or volume checks are performed. The verification is structural only.

SDK-level validation (in `openTargetPosition`):
```typescript
if (!params.marketConditionId.startsWith('0x')) {
  throw new ValidationError('Invalid conditionId format');
}
```

Integrators should perform additional checks:
1. Query Polymarket orderbook for liquidity depth
2. Check market metadata (resolution source, end date)
3. Validate collateral is USDC
4. Verify market has trading activity

The protocol does not filter markets beyond binary/unresolved requirements. Due diligence is the integrator's responsibility.

### 7. Execution Types: Do you support limit orders or only market orders?

The SDK supports both market-style and limit order execution via order type configuration.

**Market-style execution** (FOK):
```typescript
orderType: 'FOK'  // Fill or Kill
```
Uses wider limit price: `bestAsk * (1 + maxSlippageBps / 10000)`
10 second timeout for aggressive fills.

**Limit order execution** (GTC/GTD):
```typescript
orderType: 'GTC'  // Good Till Cancelled
```
Uses tighter limit price: `bestAsk * (1 + maxSlippageBps / 20000)`
30 second timeout allows passive price improvement.

Polymarket order structure:
```typescript
{
  tokenID: string,
  price: number,      // Limit price calculated from orderbook
  side: 'BUY',
  size: number,       // Calculated from capital / price
  feeRateBps: 0
}
```

Both order types use limit prices for slippage protection. The distinction is timeout duration and price aggressiveness. True market orders (no limit price) are not supported for safety.

### 8. Ethers.js Version: Can we use ethers v6 or do we need v5?

The SDK supports both ethers v5 and v6 via peer dependency configuration:

```json
"dependencies": {
  "ethers": "5.7.2"
},
"peerDependencies": {
  "ethers": "5.7.2 || ^6.0.0"
}
```

Your application can use ethers v6. Pass v6 Provider and Signer objects directly:

```typescript
// Your app using ethers v6
import { ethers } from 'ethers';  // v6

const provider = new ethers.BrowserProvider(window.ethereum);
const signer = await provider.getSigner();

// SDK accepts v6 signer, converts internally to v5
const sdk = new ForecastLeverageSDK(
  await provider._getConnection().url,  // RPC URL
  signer,                                // v6 signer
  protocolAddress,
  usdcAddress,
  ctfAddress,
  polymarketFunderAddress
);
```

Internal conversion logic:
1. SDK detects signer type
2. Extracts private key via v6 signing key interface
3. Creates v5 Wallet instance for Polymarket CLOB client
4. All contract interactions use v5 internally

No need to install or import ethers v5 in your application. The SDK handles version bridging transparently.

## Contract Addresses

Polygon Mainnet:
```
USDC: 0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174
CTF:  0x4D97DCd97eC945f40cF65F87097ACe5EA0476045
```

Protocol address: Contact team for deployment address.

## Support

For technical questions or integration assistance, open an issue at the GitHub repository.
