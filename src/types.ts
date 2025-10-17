export interface TargetPositionParams {
  marketConditionId: string;      // Polymarket condition ID (bytes32)
  longYes: boolean;                // true = long YES, false = long NO
  currentPrice: number;            // Current price (0.40 = 40¢)
  targetPrice: number;             // Target price (0.44 = 44¢)
  timeframeSeconds: number;        // Time until target (3600 = 1 hour)
  capitalUSDC: number;             // Capital in dollars (1000 = $1000)
  maxSlippageBps: number;          // Max slippage in bps (100 = 1%)
}

export interface LeveragePosition {
  legIds: bigint[];
  totalExposure: number;
  effectiveLeverage: number;
  capitalDeployed: number;
  fees: {
    protocolSenior: number;
    protocolJunior: number;
    polymarketSlippage: number;
    gas: number;
    total: number;
  };
  pnl: {
    atTarget: number;
    breakeven: number;
    maxProfit: number;
    maxLoss: number;
  };
  autoCloseTime: number;
  F: number;
  R: number;
}

export interface LeverageParams {
  F: number;
  R: number;
  loops: number;
  maxLeverage: number;
  tokenId: string;
}
