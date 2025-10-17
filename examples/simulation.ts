import { ForecastLeverageSDK } from '@forecast-protocol/leverage-sdk';

const sdk = new ForecastLeverageSDK(/* ... */);

async function compareScenarios() {
  const baseParams = {
    marketConditionId: process.env.MARKET_ID!,
    longYes: true,
    currentPrice: 0.40,
    targetPrice: 0.45,
    capitalUSDC: 1000,
    maxSlippageBps: 100
  };

  // Compare different timeframes
  const timeframes = [
    { name: '1 hour', seconds: 3600 },
    { name: '6 hours', seconds: 21600 },
    { name: '24 hours', seconds: 86400 },
    { name: '7 days', seconds: 604800 }
  ];

  console.log('Timeframe Comparison:\n');
  console.log('Time      | Leverage | Fees    | PnL at Target');
  console.log('----------|----------|---------|---------------');

  for (const tf of timeframes) {
    const position = await sdk.simulatePosition({
      ...baseParams,
      timeframeSeconds: tf.seconds
    });

    console.log(
      `${tf.name.padEnd(9)} | ` +
      `${position.effectiveLeverage.toFixed(2)}x`.padEnd(8) + ' | ' +
      `$${position.fees.total.toFixed(2)}`.padEnd(7) + ' | ' +
      `$${position.pnl.atTarget.toFixed(2)}`
    );
  }

  // Compare different capital amounts
  console.log('\n\nCapital Comparison:\n');
  console.log('Capital | Leverage | Total Fees | Net PnL');
  console.log('--------|----------|------------|--------');

  const amounts = [100, 500, 1000, 5000, 10000];

  for (const amount of amounts) {
    const position = await sdk.simulatePosition({
      ...baseParams,
      capitalUSDC: amount,
      timeframeSeconds: 3600
    });

    console.log(
      `$${amount}`.padEnd(7) + ' | ' +
      `${position.effectiveLeverage.toFixed(2)}x`.padEnd(8) + ' | ' +
      `$${position.fees.total.toFixed(2)}`.padEnd(10) + ' | ' +
      `$${position.pnl.atTarget.toFixed(2)}`
    );
  }
}

compareScenarios().catch(console.error);
