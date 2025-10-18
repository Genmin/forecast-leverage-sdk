import { ClobClient, OrderType, Side } from "@polymarket/clob-client";
import { ethers, Wallet } from "ethers";

/**
 * TURNKEY LEVERAGE SDK FOR POLYMARKET INTEGRATION
 *
 * Target-based UX: User picks "YES 40¢ → 44¢ in 1 hour with $1000"
 * SDK handles everything else.
 *
 * PROTOCOL MECHANICS (Critical):
 *
 * 1. COLLATERAL = 1 YES + 1 NO = always $1 (CTF guarantee)
 *    - Each "set" of collateral has guaranteed $1 value
 *    - User deposits LONG tokens, protocol borrows SHORT from junior pool
 *
 * 2. BORROWING:
 *    - Against $1 collateral, protocol lends F * $1 USDC
 *    - F = capital efficiency (typically 0.85-0.95)
 *    - Example: 1000 tokens → borrow 900 USDC (F=0.9)
 *
 * 3. LOOP LEVERAGE:
 *    - Buy tokens with capital C
 *    - Loop: Deposit → borrow C*F → buy more → deposit → borrow C*F² → ...
 *    - Max leverage = 1 / (1 - F) [geometric series]
 *
 * 4. RUNWAY:
 *    - Debt per set: F * (1 + R * time/year)
 *    - RUNWAY = time until debt hits $1
 *    - Formula: runway = (1 - F) / (F * R) * year
 *    - Term MUST be < runway
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
  private provider: ethers.Provider;
  private signer: Wallet;
  private polymarketClient: ClobClient;
  private protocolContract: ethers.Contract;
  private usdcContract: ethers.Contract;
  private ctfContract: ethers.Contract;

  constructor(
    rpcUrl: string,
    privateKey: string,
    protocolAddress: string,
    usdcAddress: string,
    ctfAddress: string,
    polymarketApiCreds: any,
    polymarketFunderAddress: string
  ) {
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    this.signer = new Wallet(privateKey, this.provider);

    // Initialize Polymarket CLOB client
    this.polymarketClient = new ClobClient(
      "https://clob.polymarket.com",
      137, // Polygon
      this.signer,
      polymarketApiCreds,
      1, // signature type
      polymarketFunderAddress
    );

    // Initialize protocol contracts
    this.protocolContract = new ethers.Contract(protocolAddress, FORECAST_PROTOCOL_ABI, this.signer);
    this.usdcContract = new ethers.Contract(usdcAddress, ERC20_ABI, this.signer);
    this.ctfContract = new ethers.Contract(ctfAddress, CTF_ABI, this.signer);
  }

  /**
   * SIMULATION MODE: Estimate position without executing
   *
   * Useful for:
   * - Testing integrations
   * - Showing users projected outcomes before execution
   * - Validating parameters
   *
   * @throws ValidationError if inputs are invalid
   */
  async simulatePosition(params: TargetPositionParams): Promise<LeveragePosition> {
    // Validate inputs
    this.validateInputs(params);

    console.log(`[SIMULATION] Position: ${params.currentPrice} → ${params.targetPrice} in ${params.timeframeSeconds}s`);

    try {
      // Calculate leverage parameters (read-only)
      const leverageParams = await this.calculateLeverageParams(params);
      console.log(`[SIMULATION] Calculated: ${leverageParams.loops} loops, ${leverageParams.F}% capital efficiency`);

      // Simulate loop execution
      let totalTokens = 0;
      let remainingUSDC = params.capitalUSDC;

      for (let i = 0; i < leverageParams.loops; i++) {
        // Buy tokens at current price
        const tokensThisLoop = remainingUSDC / params.currentPrice;
        totalTokens += tokensThisLoop;

        // Simplified leverage model: borrow F * (token value) in USDC
        // This creates convergent geometric series: capital * (1-F^n)/(1-F)
        remainingUSDC = tokensThisLoop * leverageParams.F * params.currentPrice;

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
   * MAIN ENTRY POINT: Open leveraged position based on price target
   *
   * User specifies: "I want YES to go from 40¢ to 44¢ in 1 hour"
   * SDK handles everything else
   *
   * @throws ValidationError if inputs are invalid
   * @throws PolymarketError if order fails
   * @throws ProtocolError if protocol interaction fails
   */
  async openTargetPosition(params: TargetPositionParams): Promise<LeveragePosition> {
    // Validate inputs
    this.validateInputs(params);

    console.log(`Opening position: ${params.currentPrice} → ${params.targetPrice} in ${params.timeframeSeconds}s`);

    try {
      // Check USDC balance
      await this.checkSufficientBalance(params.capitalUSDC);

      // Verify market exists
      await this.verifyMarket(params.marketConditionId);

      // Step 1: Calculate leverage parameters
      const leverageParams = await this.calculateLeverageParams(params);
      console.log(`Calculated: ${leverageParams.loops} loops, ${leverageParams.F}% capital efficiency`);

      // Step 2: Approve protocol and CTF
      await this.setupApprovals();

      // Step 3: Execute leverage loop
      const legIds: bigint[] = [];
      let remainingUSDC = params.capitalUSDC * 1e6; // Convert to USDC decimals
      let totalTokensBought = 0;
      let totalSlippage = 0;

      for (let i = 0; i < leverageParams.loops; i++) {
        console.log(`Loop ${i + 1}/${leverageParams.loops}: ${remainingUSDC / 1e6} USDC available`);

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
          console.error(`Loop ${i + 1} failed:`, error.message);
          // If we have at least one leg, continue with partial position
          if (legIds.length > 0) {
            console.log(`Continuing with ${legIds.length} legs`);
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
   * Validate term doesn't exceed runway
   * Runway = time until debt reaches $1 per set
   * Debt formula: F * (1 + R * time/year)
   * Runway when debt = 1: (1 - F) / (F * R) * year
   */
  private validateRunway(F: number, R: number, termSeconds: number): void {
    if (R === 0) return; // Zero rates = infinite runway

    const YEAR_SECONDS = 365 * 24 * 3600;
    const runway = ((1 - F) / (F * R)) * YEAR_SECONDS;
    const safeRunway = runway * 0.95; // 95% safety margin

    if (termSeconds >= safeRunway) {
      const termHours = termSeconds / 3600;
      const runwayHours = safeRunway / 3600;

      throw new ValidationError(
        `Term ${termHours.toFixed(1)}h exceeds safe runway ${runwayHours.toFixed(1)}h. ` +
        `Debt would exceed collateral value. ` +
        `Try shorter timeframe or wait for lower rates.`
      );
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

    // Validate term doesn't exceed runway
    this.validateRunway(F, R, params.timeframeSeconds);

    // Calculate loops to reach ~90% of max leverage
    // Geometric series: (1 - F^N) / (1 - F) approaches 1 / (1 - F)
    // To reach 90%: F^N = 0.1, so N = log(0.1) / log(F)
    const maxLeverage = 1 / (1 - F);
    const loops = Math.min(
      Math.ceil(Math.log(0.1) / Math.log(F)),
      10  // Safety cap
    );

    // Get token ID from condition
    const tokenId = params.longYes
      ? await this.getYesTokenId(params.marketConditionId)
      : await this.getNoTokenId(params.marketConditionId);

    return {
      F,
      R,
      loops,  // Already capped above
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
    console.log(`Buying ${usdcAmount / 1e6} USDC worth of tokens...`);

    try {
      // Get current orderbook price
      const orderbook = await this.polymarketClient.getOrderBook(tokenId);
      if (!orderbook.asks || orderbook.asks.length === 0) {
        throw new PolymarketError(`No liquidity available for token ${tokenId}`);
      }

      const bestAsk = orderbook.asks[0].price;
      if (bestAsk <= 0 || bestAsk >= 1) {
        throw new PolymarketError(`Invalid orderbook price: ${bestAsk}`);
      }

      // Calculate order size
      const orderSize = (usdcAmount / 1e6) / bestAsk;
      const limitPrice = bestAsk * (1 + maxSlippageBps / 10000);

      // Place FOK market order
      const order = await this.polymarketClient.createAndPostOrder(
        {
          tokenID: tokenId,
          price: limitPrice,
          side: Side.BUY,
          size: orderSize,
          feeRateBps: 0,
        },
        { tickSize: "0.001", negRisk: false },
        OrderType.FOK
      );

      if (!order || !order.orderID) {
        throw new PolymarketError('Failed to create order: no order ID returned');
      }

      // Wait for order confirmation
      await this.waitForOrderFill(order.orderID);

      // Get actual tokens received
      const tokensReceived = order.size * 1e6; // Convert to 6 decimals
      const actualPrice = (usdcAmount / 1e6) / order.size;
      const slippage = (actualPrice - bestAsk) * order.size;

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

      if (order.status === "MATCHED" || order.associate_trades?.some(t => t.status === "CONFIRMED")) {
        console.log(`Order ${orderId} filled`);
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

    console.log(`Opening protocol leg: ${sets} sets for ${term}s`);

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
      const legOpenedEvent = receipt.logs.find((log: any) =>
        log.topics[0] === ethers.id("LegOpened(uint256,uint256,uint256)")
      );

      if (!legOpenedEvent) {
        throw new ProtocolError('LegOpened event not found in transaction');
      }

      return BigInt(legOpenedEvent.topics[1]);
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
    // Approve USDC for protocol
    await this.usdcContract.approve(
      await this.protocolContract.getAddress(),
      ethers.MaxUint256
    );

    // Approve CTF tokens for protocol
    await this.ctfContract.setApprovalForAll(
      await this.protocolContract.getAddress(),
      true
    );

    console.log("Approvals set");
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
    const gasPrice = (await this.provider.getFeeData()).gasPrice || 0n;
    const gasCostUSDC = Number(gasUsed * Number(gasPrice)) / 1e18 * 1; // Assume $1/MATIC

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
   * Close entire leverage position (all legs)
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
