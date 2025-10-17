import { ForecastLeverageSDK } from '@forecast-protocol/leverage-sdk';

// Initialize SDK
const sdk = new ForecastLeverageSDK(
  process.env.RPC_URL!,
  process.env.PRIVATE_KEY!,
  process.env.PROTOCOL_ADDRESS!,
  '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174', // USDC (Polygon)
  '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045', // CTF (Polygon)
  JSON.parse(process.env.POLYMARKET_CREDS!),
  process.env.POLYMARKET_FUNDER!
);

async function main() {
  // Define position parameters
  const params = {
    marketConditionId: process.env.MARKET_ID!,
    longYes: true,
    currentPrice: 0.40,      // 40¢
    targetPrice: 0.44,       // 44¢
    timeframeSeconds: 3600,  // 1 hour
    capitalUSDC: 1000,       // $1000
    maxSlippageBps: 100      // 1%
  };

  // Open position
  console.log('Opening position...');
  const position = await sdk.openTargetPosition(params);

  console.log('Position opened:');
  console.log(`  Leverage: ${position.effectiveLeverage.toFixed(2)}x`);
  console.log(`  Total fees: $${position.fees.total.toFixed(2)}`);
  console.log(`  PnL at target: $${position.pnl.atTarget.toFixed(2)}`);
  console.log(`  Breakeven: ${position.pnl.breakeven.toFixed(4)}`);
  console.log(`  Auto-closes: ${new Date(position.autoCloseTime).toLocaleString()}`);

  // Wait for user input to close
  console.log('\nPress Enter to close position...');
  await new Promise(resolve => process.stdin.once('data', resolve));

  // Close position
  console.log('Closing position...');
  const pnl = await sdk.closePosition(position.legIds);
  console.log(`Position closed. PnL: $${pnl.toFixed(2)}`);
}

main().catch(console.error);
