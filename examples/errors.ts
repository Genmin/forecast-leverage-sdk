import {
  ForecastLeverageSDK,
  ValidationError,
  PolymarketError,
  ProtocolError
} from '@forecast-protocol/leverage-sdk';

const sdk = new ForecastLeverageSDK(/* ... */);

async function openPositionWithErrorHandling(params: any) {
  try {
    // 1. Simulate first
    console.log('Simulating position...');
    const preview = await sdk.simulatePosition(params);

    console.log(`Preview: ${preview.effectiveLeverage.toFixed(2)}x leverage`);
    console.log(`Fees: $${preview.fees.total.toFixed(2)}`);
    console.log(`PnL at target: $${preview.pnl.atTarget.toFixed(2)}`);

    // Check if profitable
    if (preview.pnl.atTarget < 0) {
      console.warn('Warning: Position not profitable at target price');
      return null;
    }

    // 2. Execute with retries
    let retries = 0;
    while (retries < 3) {
      try {
        console.log(`Opening position (attempt ${retries + 1}/3)...`);
        const position = await sdk.openTargetPosition(params);
        console.log('Success!');
        return position;

      } catch (error) {
        // Retry on Polymarket errors (transient issues)
        if (error instanceof PolymarketError && retries < 2) {
          console.log('Polymarket error, retrying in 2s...');
          await new Promise(resolve => setTimeout(resolve, 2000));
          retries++;
          continue;
        }
        throw error;
      }
    }

  } catch (error) {
    if (error instanceof ValidationError) {
      // Input validation failed - fix parameters
      console.error('Invalid parameters:', error.message);
      console.error('Please check:');
      console.error('  - Prices are between 0 and 1');
      console.error('  - Price direction matches position type');
      console.error('  - Capital is at least $10');
      console.error('  - Slippage is 0-50%');
      return null;

    } else if (error instanceof PolymarketError) {
      // Polymarket order failed - likely liquidity issue
      console.error('Polymarket order failed:', error.message);
      console.error('Possible causes:');
      console.error('  - Insufficient liquidity');
      console.error('  - Slippage tolerance too tight');
      console.error('  - Market paused');
      console.error('Try:');
      console.error('  - Reduce position size');
      console.error('  - Increase slippage tolerance');
      console.error('  - Try different market');
      return null;

    } else if (error instanceof ProtocolError) {
      // Protocol interaction failed
      console.error('Protocol error:', error.message);
      console.error('Possible causes:');
      console.error('  - Insufficient protocol liquidity');
      console.error('  - Protocol paused');
      console.error('  - Network issues');
      console.error('  - Insufficient USDC balance');
      console.error('Try:');
      console.error('  - Check protocol status');
      console.error('  - Verify USDC balance');
      console.error('  - Try again later');
      return null;

    } else {
      // Unexpected error
      console.error('Unexpected error:', error);
      throw error;
    }
  }
}

// Example usage
const params = {
  marketConditionId: process.env.MARKET_ID!,
  longYes: true,
  currentPrice: 0.40,
  targetPrice: 0.44,
  timeframeSeconds: 3600,
  capitalUSDC: 1000,
  maxSlippageBps: 100
};

openPositionWithErrorHandling(params)
  .then(position => {
    if (position) {
      console.log('Position opened successfully:', position.legIds);
    } else {
      console.log('Position not opened');
    }
  })
  .catch(console.error);
