import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { ethers } from "ethers";
import { Wallet } from "@ethersproject/wallet";

/**
 * Forecast Protocol SDK
 *
 * Provides leveraged trading for Polymarket prediction markets.
 * Positions are opened via automated loop execution that buys tokens
 * and opens protocol legs using borrowed capital.
 *
 * The SDK accepts target-based parameters (price and timeframe)
 * and calculates leverage automatically.
 */

// Protocol ABIs
const FORECAST_PROTOCOL_ABI = [
  "function open(uint96 sets, uint32 term, bytes32 conditionId, bool longYes) external returns (uint256 legId)",
  "function close(uint256 legId) external",
  "function quote(uint96 sets, uint32 term, bytes32 conditionId, bool longYes) external view returns (uint256 F, uint256 rS, uint256 rJ, uint256 usdcNeeded, bool converged)",
  "function legs(uint256 legId) external view returns (uint96 sets, uint96 F_e18, uint96 rS_e18, uint96 rJ_e18, uint32 opened, uint32 term, address borrower, address escrow, uint256 longPositionId, uint256 shortPositionId, bytes32 conditionId)",
  "function yesPositionId(bytes32 conditionId) external view returns (uint256)",
  "function noPositionId(bytes32 conditionId) external view returns (uint256)",
  "function verifyMarket(bytes32 conditionId) external",
];

const ERC20_ABI = [
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function balanceOf(address account) external view returns (uint256)",
];

const CTF_ABI = [
  "function setApprovalForAll(address operator, bool approved) external",
  "function balanceOf(address account, uint256 id) external view returns (uint256)",
];

interface TargetPositionParams {
  marketConditionId: string;      // Polymarket condition ID (bytes32 hex string)
  longYes: boolean;                // true = long YES, false = long NO
  currentPrice: number;            // Current price in decimals (0.40 = 40¢)
  targetPrice: number;             // Target price (0.44 = 44¢)
  timeframeSeconds: number;        // Time until target (3600 = 1 hour)
  capitalUSDC: number;             // Capital to deploy in dollars ($1000)
  maxSlippageBps: number;          // Max slippage in basis points (100 = 1%)
}

interface LeverageParams {
  F: number;                       // Capital efficiency factor
  R: number;                       // Total annual rate (rS + rJ)
  loops: number;                   // Number of loop iterations
  maxLeverage: number;             // Maximum achievable leverage
  tokenId: string;                 // Polymarket token ID
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

class PolymarketError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PolymarketError';
  }
}

class ProtocolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProtocolError';
  }
}

interface LeveragePosition {
  legIds: bigint[];                // All protocol leg IDs
  totalExposure: number;           // Total token exposure
  effectiveLeverage: number;       // Actual leverage achieved
  capitalDeployed: number;         // USDC spent
  fees: {
    protocolSenior: number;        // Interest to senior pool
    protocolJunior: number;        // Interest to junior pool
    polymarketSlippage: number;    // Slippage on token purchases
    gas: number;                   // Total gas costs
    total: number;                 // Sum of all fees
  };
  pnl: {
    atTarget: number;              // PnL if target price hit
    breakeven: number;             // Price needed to breakeven
    maxProfit: number;             // Max profit (at $1.00)
    maxLoss: number;               // Max loss (at $0.00 or auto-close)
  };
  autoCloseTime: number;           // Timestamp when position auto-closes
  F: number;                       // Capital efficiency factor
  R: number;                       // Total rate (rS + rJ)
}

// Export error classes for integrator error handling
export { ValidationError, PolymarketError, ProtocolError };

// Export types
export type { TargetPositionParams, LeveragePosition, LeverageParams };

export class ForecastLeverageSDK {
  private provider: ethers.providers.Provider;
  private signer: Wallet;
  private polymarketClient: ClobClient;
  private protocolContract: ethers.Contract;
  private usdcContract: ethers.Contract;
  private ctfContract: ethers.Contract;

  private polymarketFunderAddress: string;
  private polymarketHost: string = "https://clob.polymarket.com";
  private polymarketChainId: number = 137;
  private polymarketInitialized: boolean = false;

  constructor(
    rpcUrl: string,
    privateKey: string,
    protocolAddress: string,
    usdcAddress: string,
    ctfAddress: string,
    polymarketFunderAddress: string
  ) {
    this.provider = new ethers.providers.JsonRpcProvider(rpcUrl);
    this.signer = new Wallet(privateKey, this.provider);
    this.polymarketFunderAddress = polymarketFunderAddress;

    // Note: Polymarket client initialized async in setup method
    this.polymarketClient = null as any; // Will be set in setupPolymarket()

    // Initialize protocol contracts
    this.protocolContract = new ethers.Contract(protocolAddress, FORECAST_PROTOCOL_ABI, this.signer);
    this.usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, this.signer);
    this.ctfContract = new ethers.Contract(ctfAddress, CTF_ABI, this.signer);
  }

  /**
   * Initialize Polymarket CLOB client with API credentials.
   * Must be called before using any Polymarket functionality.
   *
   * @throws {Error} If API key derivation fails
   *
   * @example
   * ```typescript
   * await sdk.setupPolymarket();
   * ```
   */
  async setupPolymarket(): Promise<void> {
    if (this.polymarketInitialized) {
      return; // Already set up
    }

    // Create or derive API key
    const creds = await new ClobClient(
      this.polymarketHost,
      this.polymarketChainId,
      this.signer
    ).createOrDeriveApiKey();

    // Initialize authenticated client
    this.polymarketClient = new ClobClient(
      this.polymarketHost,
      this.polymarketChainId,
      this.signer,
      creds,
      1, // signature type (1 = private key)
      this.polymarketFunderAddress
    );

    this.polymarketInitialized = true;
  }

  /**
   * Estimates position metrics without executing trades.
   * Useful for testing integrations, displaying projections to users,
   * and validating parameters before execution.
   *
   * @param params - Target position parameters including market, prices, timeframe, and capital
   * @returns Estimated position including leverage, fees, and PnL projections
   * @throws {ValidationError} If input parameters are invalid or out of acceptable ranges
   *
   * @example
   * ```typescript
   * const simulation = await sdk.simulatePosition({
   *   marketConditionId: '0x7cb031...',
   *   longYes: true,
   *   currentPrice: 0.40,
   *   targetPrice: 0.44,
   *   timeframeSeconds: 3600,
   *   capitalUSDC: 1000,
   *   maxSlippageBps: 100
   * });
   *
   * console.log(`Leverage: ${simulation.effectiveLeverage.toFixed(2)}x`);
   * console.log(`Total fees: $${simulation.fees.total.toFixed(2)}`);
   * ```
   */
  async simulatePosition(params: TargetPositionParams): Promise<LeveragePosition> {
    // Validate inputs
    this.validateInputs(params);

    // Ensure Polymarket client is set up (for simulation we don't actually need it, but keep interface consistent)
    await this.setupPolymarket();

    console.log(`[SIMULATION] Position: ${params.currentPrice} → ${params.targetPrice} in ${params.timeframeSeconds}s`);

    try {
      // Calculate leverage parameters (read-only)
      const leverageParams = await this.calculateLeverageParams(params);
      console.log(`[SIMULATION] Calculated: ${leverageParams.loops} loops, ${leverageParams.F}% capital efficiency`);

      // Simulate loop execution
      let totalTokens = 0;
      let remainingUSDC = params.capitalUSDC;

      for (let i = 0; i < leverageParams.loops; i++) {
        // Estimate tokens from current capital
        const tokensThisLoop = remainingUSDC / params.currentPrice;
        totalTokens += tokensThisLoop;

        // Estimate borrowed USDC for next loop
        // Protocol lends F per token because each token pairs with short = $1 collateral (CTF guarantee)
        // NOT multiplied by market price - borrowing is based on redemption value
        remainingUSDC = tokensThisLoop * leverageParams.F;

        if (remainingUSDC < 1) break;
      }

      // Create dummy leg IDs for simulation
      const legIds = Array.from({ length: leverageParams.loops }, (_, i) => BigInt(i));

      // Calculate metrics with estimated values
      const result = await this.calculatePositionMetrics(
        legIds,
        params,
        totalTokens * 1e6, // Convert to 6 decimals
        0, // No slippage in simulation
        leverageParams
      );

      console.log(`[SIMULATION] Leverage: ${result.effectiveLeverage.toFixed(2)}x`);
      console.log(`[SIMULATION] Total fees: $${result.fees.total.toFixed(2)}`);
      console.log(`[SIMULATION] PnL at target: $${result.pnl.atTarget.toFixed(2)}`);

      return result;
    } catch (error: any) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new Error(`Simulation failed: ${error.message}`);
    }
  }

  /**
   * Opens a leveraged position based on target price parameters.
   * Executes the complete loop: buying tokens on Polymarket and opening
   * protocol legs until the desired leverage is achieved.
   *
   * @param params - Target position parameters including market, prices, timeframe, and capital
   * @returns Position details including leg IDs, leverage, fees, and PnL scenarios
   * @throws {ValidationError} If input parameters are invalid or insufficient balance
   * @throws {PolymarketError} If Polymarket order fails or has no liquidity
   * @throws {ProtocolError} If protocol interaction fails or has insufficient liquidity
   *
   * @example
   * ```typescript
   * const position = await sdk.openTargetPosition({
   *   marketConditionId: '0x7cb031...',
   *   longYes: true,
   *   currentPrice: 0.40,
   *   targetPrice: 0.44,
   *   timeframeSeconds: 3600,
   *   capitalUSDC: 1000,
   *   maxSlippageBps: 100
   * });
   *
   * console.log(`Position opened: ${position.legIds.length} legs`);
   * console.log(`Leverage: ${position.effectiveLeverage.toFixed(2)}x`);
   * ```
   */
  async openTargetPosition(params: TargetPositionParams): Promise<LeveragePosition> {
    // Validate inputs
    this.validateInputs(params);

    // Initialize Polymarket client
    await this.setupPolymarket();

    try {
      // Check USDC balance
      await this.checkSufficientBalance(params.capitalUSDC);

      // Verify market exists
      await this.verifyMarket(params.marketConditionId);

      // Step 1: Calculate leverage parameters
      const leverageParams = await this.calculateLeverageParams(params);

      // Step 2: Approve protocol and CTF
      await this.setupApprovals();

      // Step 3: Execute leverage loop
      const legIds: bigint[] = [];
      let remainingUSDC = params.capitalUSDC * 1e6; // Convert to USDC decimals
      let totalTokensBought = 0;
      let totalSlippage = 0;

      for (let i = 0; i < leverageParams.loops; i++) {
        try {
          // 3a. Buy tokens on Polymarket
          const buyResult = await this.buyTokensPolymarket(
            leverageParams.tokenId,
            remainingUSDC,
            params.maxSlippageBps
          );
          totalTokensBought += buyResult.tokensReceived;
          totalSlippage += buyResult.slippage;

          // 3b. Open protocol leg
          const legId = await this.openProtocolLeg(
            buyResult.tokensReceived,
            params.timeframeSeconds,
            params.marketConditionId,
            params.longYes
          );
          legIds.push(legId);

          // 3c. Check borrowed USDC balance
          const usdcBalance = await this.usdcContract.balanceOf(this.signer.address);
          remainingUSDC = Number(usdcBalance);

          // Stop if insufficient USDC for next loop
          if (remainingUSDC < 1e6) break; // Less than $1
        } catch (error: any) {
          // If we have at least one leg, continue with partial position
          if (legIds.length > 0) {
            break;
          }
          // If first loop fails, propagate error
          throw error;
        }
      }

      if (legIds.length === 0) {
        throw new ProtocolError('Failed to open any position legs');
      }

      // Step 4: Calculate final position metrics
      return await this.calculatePositionMetrics(
        legIds,
        params,
        totalTokensBought,
        totalSlippage,
        leverageParams
      );
    } catch (error: any) {
      if (error instanceof ValidationError || error instanceof PolymarketError || error instanceof ProtocolError) {
        throw error;
      }
      throw new ProtocolError(`Position opening failed: ${error.message}`);
    }
  }

  /**
   * Validate input parameters
   */
  private validateInputs(params: TargetPositionParams): void {
    // Market condition ID
    if (!params.marketConditionId || !params.marketConditionId.startsWith('0x')) {
      throw new ValidationError('Invalid marketConditionId: must be a hex string starting with 0x');
    }

    // Prices
    if (params.currentPrice <= 0 || params.currentPrice >= 1) {
      throw new ValidationError(`Invalid currentPrice: ${params.currentPrice} (must be between 0 and 1)`);
    }
    if (params.targetPrice <= 0 || params.targetPrice >= 1) {
      throw new ValidationError(`Invalid targetPrice: ${params.targetPrice} (must be between 0 and 1)`);
    }

    // Price direction must match position direction
    if (params.longYes && params.targetPrice <= params.currentPrice) {
      throw new ValidationError(`Invalid price direction: LONG YES requires targetPrice > currentPrice`);
    }
    if (!params.longYes && params.targetPrice >= params.currentPrice) {
      throw new ValidationError(`Invalid price direction: LONG NO requires targetPrice < currentPrice`);
    }

    // Timeframe
    if (params.timeframeSeconds <= 0) {
      throw new ValidationError(`Invalid timeframe: ${params.timeframeSeconds} (must be > 0)`);
    }
    if (params.timeframeSeconds < 60) {
      throw new ValidationError(`Invalid timeframe: ${params.timeframeSeconds}s (too short, min 60s)`);
    }
    if (params.timeframeSeconds > 365 * 24 * 3600) {
      throw new ValidationError(`Invalid timeframe: ${params.timeframeSeconds}s (too long, max 1 year)`);
    }

    // Capital
    if (params.capitalUSDC <= 0) {
      throw new ValidationError(`Invalid capital: ${params.capitalUSDC} (must be > 0)`);
    }
    if (params.capitalUSDC < 10) {
      throw new ValidationError(`Invalid capital: ${params.capitalUSDC} (minimum $10)`);
    }

    // Slippage
    if (params.maxSlippageBps < 0 || params.maxSlippageBps > 5000) {
      throw new ValidationError(`Invalid slippage: ${params.maxSlippageBps}bps (must be 0-5000, i.e., 0-50%)`);
    }
  }

  /**
   * Check if user has sufficient USDC balance
   */
  private async checkSufficientBalance(requiredUSDC: number): Promise<void> {
    const balance = await this.usdcContract.balanceOf(this.signer.address);
    const balanceUSDC = Number(balance) / 1e6;

    if (balanceUSDC < requiredUSDC) {
      throw new ValidationError(
        `Insufficient USDC balance: have $${balanceUSDC.toFixed(2)}, need $${requiredUSDC.toFixed(2)}`
      );
    }
  }

  /**
   * Verify market exists and is valid
   */
  private async verifyMarket(conditionId: string): Promise<void> {
    try {
      await this.protocolContract.verifyMarket(conditionId);
    } catch (error: any) {
      throw new ValidationError(`Invalid market: ${conditionId} - ${error.message}`);
    }
  }

  /**
   * Calculate leverage parameters from target
   */
  private async calculateLeverageParams(params: TargetPositionParams): Promise<LeverageParams> {
    // Query protocol for F and rates
    const quote = await this.protocolContract.quote(
      1, // 1 set to get base rates
      params.timeframeSeconds,
      params.marketConditionId,
      params.longYes
    );

    const F = Number(quote.F) / 1e18;
    const R = (Number(quote.rS) + Number(quote.rJ)) / 1e18;

    // Calculate loops needed based on capital and F
    // Geometric series: total_exposure = capital × 1/(1-F)
    const maxLeverage = 1 / (1 - F);
    const loops = Math.floor(Math.log(1 - maxLeverage * (1 - F)) / Math.log(F)) + 1;

    // Get token ID from condition
    const tokenId = params.longYes
      ? await this.getYesTokenId(params.marketConditionId)
      : await this.getNoTokenId(params.marketConditionId);

    return {
      F,
      R,
      loops: Math.min(loops, 10), // Cap at 10 loops for safety
      maxLeverage,
      tokenId,
    };
  }

  /**
   * Buy tokens on Polymarket with FOK order
   */
  private async buyTokensPolymarket(
    tokenId: string,
    usdcAmount: number,
    maxSlippageBps: number
  ): Promise<{ tokensReceived: number; slippage: number }> {
    try {
      // Get current orderbook price
      const orderbook = await this.polymarketClient.getOrderBook(tokenId);
      if (!orderbook.asks || orderbook.asks.length === 0) {
        throw new PolymarketError(`No liquidity available for token ${tokenId}`);
      }

      const bestAskPrice = parseFloat(orderbook.asks[0].price);
      if (bestAskPrice <= 0 || bestAskPrice >= 1) {
        throw new PolymarketError(`Invalid orderbook price: ${bestAskPrice}`);
      }

      // Calculate order size
      const orderSizeCalc = (usdcAmount / 1e6) / bestAskPrice;
      const limitPrice = bestAskPrice * (1 + maxSlippageBps / 10000);

      // Place GTC market order (FOK not supported in v4, using GTC instead)
      const order = await this.polymarketClient.createAndPostOrder(
        {
          tokenID: tokenId,
          price: limitPrice,
          side: Side.BUY,
          size: orderSizeCalc,
          feeRateBps: 0,
        },
        { tickSize: "0.001", negRisk: false },
        OrderType.GTC
      );

      if (!order || !order.orderID) {
        throw new PolymarketError('Failed to create order: no order ID returned');
      }

      // Wait for order confirmation
      await this.waitForOrderFill(order.orderID);

      // Get actual tokens received from order
      const orderSizeFilled = parseFloat(order.size);
      const tokensReceived = orderSizeFilled * 1e6; // Convert to 6 decimals
      const actualPrice = (usdcAmount / 1e6) / orderSizeFilled;
      const slippage = (actualPrice - bestAskPrice) * orderSizeFilled;

      return {
        tokensReceived: Math.floor(tokensReceived),
        slippage,
      };
    } catch (error: any) {
      if (error instanceof PolymarketError) {
        throw error;
      }
      throw new PolymarketError(`Order failed: ${error.message}`);
    }
  }

  /**
   * Wait for Polymarket order to fill
   */
  private async waitForOrderFill(orderId: string): Promise<void> {
    // Poll order status until CONFIRMED
    for (let i = 0; i < 30; i++) {
      const order = await this.polymarketClient.getOrder(orderId);

      if (order.status === "MATCHED" || order.associate_trades?.some((t: any) => t.status === "CONFIRMED")) {
        return;
      }

      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
    }

    throw new Error(`Order ${orderId} failed to fill within 30 seconds`);
  }

  /**
   * Open a single protocol leg
   */
  private async openProtocolLeg(
    tokenAmount: number,
    term: number,
    conditionId: string,
    longYes: boolean
  ): Promise<bigint> {
    const sets = Math.floor(tokenAmount / 1e6); // Convert to sets

    if (sets === 0) {
      throw new ProtocolError(`Insufficient tokens: ${tokenAmount} (need at least 1 set)`);
    }

    try {
      const tx = await this.protocolContract.open(
        sets,
        term,
        conditionId,
        longYes
      );

      const receipt = await tx.wait();

      if (!receipt || receipt.status !== 1) {
        throw new ProtocolError('Transaction failed');
      }

      // Extract legId from LegOpened event
      const eventSignature = ethers.utils.id("LegOpened(uint256,uint256,uint256)");
      const legOpenedEvent = receipt.logs.find((log: any) =>
        log.topics[0] === eventSignature
      );

      if (!legOpenedEvent) {
        throw new ProtocolError('LegOpened event not found in transaction');
      }

      return ethers.BigNumber.from(legOpenedEvent.topics[1]).toBigInt();
    } catch (error: any) {
      if (error instanceof ProtocolError) {
        throw error;
      }
      // Parse common revert reasons
      if (error.message.includes('insufficient')) {
        throw new ProtocolError('Insufficient protocol liquidity');
      }
      if (error.message.includes('paused')) {
        throw new ProtocolError('Protocol is paused');
      }
      throw new ProtocolError(`Failed to open position: ${error.message}`);
    }
  }

  /**
   * Setup all necessary approvals
   */
  private async setupApprovals(): Promise<void> {
    const protocolAddress = this.protocolContract.address;

    // Approve USDC for protocol
    const tx1 = await this.usdcContract.approve(
      protocolAddress,
      ethers.constants.MaxUint256
    );
    await tx1.wait();

    // Approve CTF tokens for protocol
    const tx2 = await this.ctfContract.setApprovalForAll(
      protocolAddress,
      true
    );
    await tx2.wait();
  }

  /**
   * Calculate final position metrics including fees and PnL
   */
  private async calculatePositionMetrics(
    legIds: bigint[],
    params: TargetPositionParams,
    totalTokens: number,
    totalSlippage: number,
    leverageParams: any
  ): Promise<LeveragePosition> {
    // Get leg details
    const legs = await Promise.all(
      legIds.map(id => this.protocolContract.legs(id))
    );

    // Calculate protocol fees
    const totalSets = legs.reduce((sum, leg) => sum + Number(leg.sets), 0);
    const avgF = legs.reduce((sum, leg) => sum + Number(leg.F_e18), 0) / legs.length / 1e18;
    const avgRS = legs.reduce((sum, leg) => sum + Number(leg.rS_e18), 0) / legs.length / 1e18;
    const avgRJ = legs.reduce((sum, leg) => sum + Number(leg.rJ_e18), 0) / legs.length / 1e18;
    const avgTerm = legs.reduce((sum, leg) => sum + Number(leg.term), 0) / legs.length;

    const seniorInterest = totalSets * avgF * avgRS * (avgTerm / (365 * 24 * 3600));
    const juniorInterest = totalSets * avgF * avgRJ * (avgTerm / (365 * 24 * 3600));

    // Estimate gas (rough)
    const gasUsed = legIds.length * 500000; // ~500k gas per leg
    const feeData = await this.provider.getFeeData();
    const gasPrice = feeData.gasPrice || ethers.BigNumber.from(0);
    const gasCostWei = gasPrice.mul(gasUsed);
    const gasCostUSDC = parseFloat(ethers.utils.formatEther(gasCostWei)) * 1; // Assume $1/MATIC

    // Calculate PnL scenarios
    const effectiveLeverage = totalTokens / (params.capitalUSDC * 1e6);
    const priceMove = params.targetPrice - params.currentPrice;
    const pnlAtTarget = (priceMove * totalTokens / 1e6) - totalSlippage - seniorInterest - juniorInterest - gasCostUSDC;

    const totalFees = totalSlippage + seniorInterest + juniorInterest + gasCostUSDC;
    const breakeven = params.currentPrice + (totalFees / (totalTokens / 1e6));

    return {
      legIds,
      totalExposure: totalTokens / 1e6,
      effectiveLeverage,
      capitalDeployed: params.capitalUSDC,
      fees: {
        protocolSenior: seniorInterest,
        protocolJunior: juniorInterest,
        polymarketSlippage: totalSlippage,
        gas: gasCostUSDC,
        total: totalFees,
      },
      pnl: {
        atTarget: pnlAtTarget,
        breakeven,
        maxProfit: ((1 - params.currentPrice) * totalTokens / 1e6) - totalFees,
        maxLoss: -params.capitalUSDC,
      },
      autoCloseTime: Date.now() + (avgTerm * 1000),
      F: avgF,
      R: avgRS + avgRJ,
    };
  }

  /**
   * Closes all legs of a leveraged position and returns proceeds.
   * Each leg is closed individually via protocol.close().
   *
   * @param legIds - Array of protocol leg IDs to close
   * @returns Total USDC received from closing all legs
   * @throws {ProtocolError} If any leg closure fails
   *
   * @example
   * ```typescript
   * const usdcReceived = await sdk.closePosition(position.legIds);
   * console.log(`Closed position, received $${usdcReceived.toFixed(2)}`);
   * ```
   */
  async closePosition(legIds: bigint[]): Promise<number> {
    let totalUSDC = 0;

    for (const legId of legIds) {
      const balanceBefore = await this.usdcContract.balanceOf(this.signer.address);

      await this.protocolContract.close(legId);

      const balanceAfter = await this.usdcContract.balanceOf(this.signer.address);
      totalUSDC += Number(balanceAfter - balanceBefore);
    }

    return totalUSDC / 1e6;
  }

  /**
   * Helper: Get YES token ID from condition
   */
  private async getYesTokenId(conditionId: string): Promise<string> {
    return await this.protocolContract.yesPositionId(conditionId);
  }

  /**
   * Helper: Get NO token ID from condition
   */
  private async getNoTokenId(conditionId: string): Promise<string> {
    return await this.protocolContract.noPositionId(conditionId);
  }
}

/**
 * USAGE EXAMPLE:
 *
 * const sdk = new ForecastLeverageSDK(
 *   "https://polygon-rpc.com",
 *   "0x...", // private key
 *   "0x...", // protocol address
 *   "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174", // USDC
 *   "0x4D97DCd97eC945f40cF65F87097ACe5EA0476045", // CTF
 *   apiCreds, // Polymarket API credentials
 *   "0x..." // Polymarket funder address
 * );
 *
 * // User wants: "YES from 40¢ to 44¢ in 1 hour with $1000"
 * const position = await sdk.openTargetPosition({
 *   marketConditionId: "0x...",
 *   longYes: true,
 *   currentPrice: 0.40,
 *   targetPrice: 0.44,
 *   timeframeSeconds: 3600,
 *   capitalUSDC: 1000,
 *   maxSlippageBps: 100, // 1%
 * });
 *
 * console.log(`Position opened with ${position.effectiveLeverage}x leverage`);
 * console.log(`Total fees: $${position.fees.total}`);
 * console.log(`PnL at target: $${position.pnl.atTarget}`);
 * console.log(`Breakeven price: ${position.pnl.breakeven}`);
 */
