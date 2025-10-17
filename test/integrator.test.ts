/**
 * INTEGRATOR TEST SUITE
 *
 * This test suite validates the ForecastLeverageSDK from an integrator's perspective.
 * It tests the public API without exposing protocol internals.
 *
 * Tests run in SIMULATION mode by default to avoid real transactions.
 *
 * Usage:
 *   npm test                        # Run all tests in simulation mode
 *   TEST_MODE=live npm test         # Run with real transactions (requires setup)
 */

import { ethers } from 'ethers';
import {
  ForecastLeverageSDK,
  ValidationError,
  PolymarketError,
  ProtocolError,
  TargetPositionParams,
  LeveragePosition
} from './ForecastLeverageSDK';

// Test configuration
const TEST_MODE = process.env.TEST_MODE || 'simulation';
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545';
const PRIVATE_KEY = process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80';

// Polygon mainnet addresses
const PROTOCOL_ADDRESS = process.env.PROTOCOL_ADDRESS || '0x363Ef3131969aC9C0EE3Bd4a67ce47865d37BE71';
const USDC_ADDRESS = '0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174';
const CTF_ADDRESS = '0x4D97DCd97eC945f40cF65F87097ACe5EA0476045';

// Test market (replace with actual market)
const TEST_MARKET = process.env.TEST_MARKET || '0x7cb031787d1693f8e0a40859f6a192bddc9280a25263946c6040179eb50267dc';

interface TestResult {
  name: string;
  passed: boolean;
  duration: number;
  error?: string;
}

class IntegratorTestSuite {
  private sdk: ForecastLeverageSDK;
  private results: TestResult[] = [];

  constructor() {
    // Initialize SDK (integrator would do this)
    this.sdk = new ForecastLeverageSDK(
      RPC_URL,
      PRIVATE_KEY,
      PROTOCOL_ADDRESS,
      USDC_ADDRESS,
      CTF_ADDRESS,
      {}, // Polymarket API creds (not needed for simulation)
      ethers.ZeroAddress // Funder address (not needed for simulation)
    );
  }

  private async runTest(name: string, testFn: () => Promise<void>): Promise<void> {
    const start = Date.now();
    try {
      await testFn();
      this.results.push({ name, passed: true, duration: Date.now() - start });
      console.log(`✓ ${name} (${Date.now() - start}ms)`);
    } catch (error: any) {
      this.results.push({
        name,
        passed: false,
        duration: Date.now() - start,
        error: error.message
      });
      console.log(`✗ ${name} (${Date.now() - start}ms)`);
      console.log(`  Error: ${error.message}`);
    }
  }

  async runAll(): Promise<void> {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`FORECAST LEVERAGE SDK - INTEGRATOR TEST SUITE`);
    console.log(`Mode: ${TEST_MODE.toUpperCase()}`);
    console.log('='.repeat(60));

    // Test 1: Input Validation
    console.log(`\n--- INPUT VALIDATION TESTS ---`);
    await this.runTest('Invalid market ID', async () => {
      const params: TargetPositionParams = {
        marketConditionId: 'invalid',
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.44,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };
      try {
        await this.sdk.simulatePosition(params);
        throw new Error('Should have thrown ValidationError');
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw new Error(`Expected ValidationError, got ${error.constructor.name}`);
        }
      }
    });

    await this.runTest('Price out of range', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 1.5, // Invalid
        targetPrice: 0.44,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };
      try {
        await this.sdk.simulatePosition(params);
        throw new Error('Should have thrown ValidationError');
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw new Error(`Expected ValidationError, got ${error.constructor.name}`);
        }
      }
    });

    await this.runTest('Wrong price direction for LONG YES', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.50,
        targetPrice: 0.40, // Target < current for LONG YES
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };
      try {
        await this.sdk.simulatePosition(params);
        throw new Error('Should have thrown ValidationError');
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw new Error(`Expected ValidationError, got ${error.constructor.name}`);
        }
        if (!error.message.includes('price direction')) {
          throw new Error(`Wrong error message: ${error.message}`);
        }
      }
    });

    await this.runTest('Capital too low', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.44,
        timeframeSeconds: 3600,
        capitalUSDC: 5, // Too low
        maxSlippageBps: 100
      };
      try {
        await this.sdk.simulatePosition(params);
        throw new Error('Should have thrown ValidationError');
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw new Error(`Expected ValidationError, got ${error.constructor.name}`);
        }
      }
    });

    await this.runTest('Excessive slippage', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.44,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 10000 // 100% - too high
      };
      try {
        await this.sdk.simulatePosition(params);
        throw new Error('Should have thrown ValidationError');
      } catch (error) {
        if (!(error instanceof ValidationError)) {
          throw new Error(`Expected ValidationError, got ${error.constructor.name}`);
        }
      }
    });

    // Test 2: Simulation Tests
    console.log(`\n--- SIMULATION TESTS ---`);

    await this.runTest('Basic LONG YES position', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.44,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      // Validate return structure
      if (!position.legIds || !Array.isArray(position.legIds)) {
        throw new Error('Missing or invalid legIds');
      }
      if (typeof position.totalExposure !== 'number' || position.totalExposure <= 0) {
        throw new Error('Invalid totalExposure');
      }
      if (typeof position.effectiveLeverage !== 'number' || position.effectiveLeverage < 1) {
        throw new Error('Invalid leverage');
      }
      if (!position.fees || typeof position.fees.total !== 'number') {
        throw new Error('Invalid fees structure');
      }
      if (!position.pnl || typeof position.pnl.atTarget !== 'number') {
        throw new Error('Invalid pnl structure');
      }
    });

    await this.runTest('Basic LONG NO position', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: false,
        currentPrice: 0.60,
        targetPrice: 0.50,
        timeframeSeconds: 7200,
        capitalUSDC: 500,
        maxSlippageBps: 150
      };

      const position = await this.sdk.simulatePosition(params);

      if (position.effectiveLeverage < 1) {
        throw new Error('Leverage should be > 1');
      }
      if (position.fees.total >= position.capitalDeployed) {
        throw new Error('Fees should not exceed capital');
      }
    });

    await this.runTest('Short timeframe (1 hour)', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.45,
        targetPrice: 0.50,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      // For short timeframes, fees should be relatively low
      const feePercentage = (position.fees.total / position.capitalDeployed) * 100;
      if (feePercentage > 10) {
        throw new Error(`Fees too high for 1-hour position: ${feePercentage.toFixed(2)}%`);
      }
    });

    await this.runTest('Long timeframe (7 days)', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.55,
        timeframeSeconds: 7 * 24 * 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      // For long timeframes, fees should be higher
      const feePercentage = (position.fees.total / position.capitalDeployed) * 100;
      if (feePercentage < 1) {
        console.log(`Warning: Fees seem low for 7-day position: ${feePercentage.toFixed(2)}%`);
      }
    });

    await this.runTest('Small price move (1¢)', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.50,
        targetPrice: 0.51,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      // Small price move should still be profitable after fees
      if (position.pnl.atTarget <= 0) {
        console.log(`Warning: Small price move not profitable. PnL: $${position.pnl.atTarget.toFixed(2)}`);
      }
    });

    await this.runTest('Large price move (20¢)', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.30,
        targetPrice: 0.50,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      // Large price move should be very profitable
      if (position.pnl.atTarget < position.capitalDeployed * 0.1) {
        throw new Error('Expected higher profit for 20¢ move');
      }
    });

    // Test 3: Edge Cases
    console.log(`\n--- EDGE CASE TESTS ---`);

    await this.runTest('Minimum capital ($10)', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.45,
        timeframeSeconds: 3600,
        capitalUSDC: 10,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      if (position.effectiveLeverage < 1) {
        throw new Error('Should achieve some leverage even with minimum capital');
      }
    });

    await this.runTest('Zero slippage tolerance', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.44,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 0
      };

      const position = await this.sdk.simulatePosition(params);

      // Should still work, just with tight execution
      if (!position || !position.legIds) {
        throw new Error('Should handle zero slippage');
      }
    });

    await this.runTest('Very short timeframe (1 minute)', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.45,
        timeframeSeconds: 60,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      // Should work for very short timeframes
      if (position.autoCloseTime < Date.now() + 60000) {
        throw new Error('Auto-close time incorrect');
      }
    });

    await this.runTest('Price near bounds (5¢)', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.05,
        targetPrice: 0.10,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      if (position.effectiveLeverage < 1) {
        throw new Error('Should handle low-price markets');
      }
    });

    await this.runTest('Price near bounds (95¢)', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: false,
        currentPrice: 0.95,
        targetPrice: 0.90,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      if (position.effectiveLeverage < 1) {
        throw new Error('Should handle high-price markets');
      }
    });

    // Test 4: Return Value Consistency
    console.log(`\n--- CONSISTENCY TESTS ---`);

    await this.runTest('Breakeven calculation consistency', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.44,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      // Breakeven should be between current price and target
      if (position.pnl.breakeven <= params.currentPrice) {
        throw new Error(`Breakeven (${position.pnl.breakeven}) should be > current price (${params.currentPrice})`);
      }
      if (position.pnl.breakeven >= params.targetPrice) {
        console.log(`Warning: Breakeven (${position.pnl.breakeven}) >= target (${params.targetPrice}) - position not profitable`);
      }
    });

    await this.runTest('Fee breakdown adds up', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.44,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      const calculatedTotal = position.fees.protocolSenior +
        position.fees.protocolJunior +
        position.fees.polymarketSlippage +
        position.fees.gas;

      const diff = Math.abs(calculatedTotal - position.fees.total);
      if (diff > 0.01) {
        throw new Error(`Fee total mismatch: ${calculatedTotal} vs ${position.fees.total}`);
      }
    });

    await this.runTest('Max profit calculation', async () => {
      const params: TargetPositionParams = {
        marketConditionId: TEST_MARKET,
        longYes: true,
        currentPrice: 0.40,
        targetPrice: 0.44,
        timeframeSeconds: 3600,
        capitalUSDC: 1000,
        maxSlippageBps: 100
      };

      const position = await this.sdk.simulatePosition(params);

      // Max profit should be when price goes to $1.00
      // Should be: (1.00 - currentPrice) * totalExposure - fees
      const expectedMaxProfit = (1 - params.currentPrice) * position.totalExposure - position.fees.total;
      const diff = Math.abs(expectedMaxProfit - position.pnl.maxProfit);

      if (diff > position.capitalDeployed * 0.01) { // Allow 1% difference
        throw new Error(`Max profit calculation off: expected ~$${expectedMaxProfit.toFixed(2)}, got $${position.pnl.maxProfit.toFixed(2)}`);
      }
    });

    // Print summary
    this.printSummary();
  }

  private printSummary(): void {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`TEST SUMMARY`);
    console.log('='.repeat(60));

    const passed = this.results.filter(r => r.passed).length;
    const failed = this.results.filter(r => r.failed).length;
    const totalTime = this.results.reduce((sum, r) => sum + r.duration, 0);

    console.log(`\nPassed: ${passed}/${this.results.length}`);
    console.log(`Failed: ${failed}/${this.results.length}`);
    console.log(`Total time: ${(totalTime / 1000).toFixed(2)}s`);

    if (failed > 0) {
      console.log(`\nFailed tests:`);
      this.results.filter(r => !r.passed).forEach(r => {
        console.log(`  - ${r.name}: ${r.error}`);
      });
    }

    const passRate = (passed / this.results.length * 100).toFixed(1);
    console.log(`\nPass rate: ${passRate}%`);

    if (passed === this.results.length) {
      console.log(`\n✓ ALL TESTS PASSED - SDK ready for integration`);
    } else {
      console.log(`\n✗ SOME TESTS FAILED - Review errors before integrating`);
      process.exit(1);
    }
  }
}

// Run tests
async function main() {
  const suite = new IntegratorTestSuite();
  await suite.runAll();
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
