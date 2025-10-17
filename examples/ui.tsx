import { useState } from 'react';
import {
  ForecastLeverageSDK,
  ValidationError,
  PolymarketError,
  ProtocolError,
  type TargetPositionParams,
  type LeveragePosition
} from '@forecast-protocol/leverage-sdk';

export function LeverageTrader({ sdk }: { sdk: ForecastLeverageSDK }) {
  const [params, setParams] = useState<TargetPositionParams>({
    marketConditionId: '',
    longYes: true,
    currentPrice: 0.50,
    targetPrice: 0.55,
    timeframeSeconds: 3600,
    capitalUSDC: 1000,
    maxSlippageBps: 100
  });

  const [preview, setPreview] = useState<LeveragePosition | null>(null);
  const [position, setPosition] = useState<LeveragePosition | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Preview position
  const handlePreview = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await sdk.simulatePosition(params);
      setPreview(result);
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(`Invalid input: ${err.message}`);
      } else {
        setError('Preview failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Execute position
  const handleExecute = async () => {
    setLoading(true);
    setError(null);

    try {
      const result = await sdk.openTargetPosition(params);
      setPosition(result);
      setPreview(null);
    } catch (err) {
      if (err instanceof ValidationError) {
        setError(`Invalid input: ${err.message}`);
      } else if (err instanceof PolymarketError) {
        setError(`Order failed: ${err.message}. Try reducing size or increasing slippage.`);
      } else if (err instanceof ProtocolError) {
        setError(`Protocol error: ${err.message}. Check network and try again.`);
      } else {
        setError('Execution failed');
      }
    } finally {
      setLoading(false);
    }
  };

  // Close position
  const handleClose = async () => {
    if (!position) return;

    setLoading(true);
    setError(null);

    try {
      const pnl = await sdk.closePosition(position.legIds);
      alert(`Position closed. PnL: $${pnl.toFixed(2)}`);
      setPosition(null);
    } catch (err) {
      setError('Failed to close position');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="leverage-trader">
      <h2>Leverage Trading</h2>

      {/* Input Form */}
      <div className="form">
        <label>
          Side:
          <select
            value={params.longYes ? 'yes' : 'no'}
            onChange={e => setParams({ ...params, longYes: e.target.value === 'yes' })}
          >
            <option value="yes">Long YES</option>
            <option value="no">Long NO</option>
          </select>
        </label>

        <label>
          Current Price:
          <input
            type="number"
            step="0.01"
            value={params.currentPrice}
            onChange={e => setParams({ ...params, currentPrice: parseFloat(e.target.value) })}
          />
        </label>

        <label>
          Target Price:
          <input
            type="number"
            step="0.01"
            value={params.targetPrice}
            onChange={e => setParams({ ...params, targetPrice: parseFloat(e.target.value) })}
          />
        </label>

        <label>
          Timeframe:
          <select
            value={params.timeframeSeconds}
            onChange={e => setParams({ ...params, timeframeSeconds: parseInt(e.target.value) })}
          >
            <option value="3600">1 hour</option>
            <option value="21600">6 hours</option>
            <option value="86400">24 hours</option>
            <option value="604800">7 days</option>
          </select>
        </label>

        <label>
          Capital (USDC):
          <input
            type="number"
            value={params.capitalUSDC}
            onChange={e => setParams({ ...params, capitalUSDC: parseFloat(e.target.value) })}
          />
        </label>

        <label>
          Max Slippage:
          <input
            type="number"
            value={params.maxSlippageBps / 100}
            onChange={e => setParams({ ...params, maxSlippageBps: parseFloat(e.target.value) * 100 })}
          />
          %
        </label>

        <button onClick={handlePreview} disabled={loading}>
          Preview Position
        </button>
      </div>

      {/* Error Display */}
      {error && (
        <div className="error">
          {error}
        </div>
      )}

      {/* Preview Display */}
      {preview && (
        <div className="preview">
          <h3>Position Preview</h3>
          <p>Leverage: <strong>{preview.effectiveLeverage.toFixed(2)}x</strong></p>
          <p>Total Fees: <strong>${preview.fees.total.toFixed(2)}</strong></p>
          <p>PnL at Target: <strong className={preview.pnl.atTarget >= 0 ? 'positive' : 'negative'}>
            ${preview.pnl.atTarget.toFixed(2)}
          </strong></p>
          <p>Breakeven: <strong>{preview.pnl.breakeven.toFixed(4)}</strong></p>

          <button onClick={handleExecute} disabled={loading}>
            Execute Position
          </button>
        </div>
      )}

      {/* Active Position */}
      {position && (
        <div className="position">
          <h3>Active Position</h3>
          <p>Leverage: <strong>{position.effectiveLeverage.toFixed(2)}x</strong></p>
          <p>Total Exposure: <strong>${position.totalExposure.toFixed(2)}</strong></p>
          <p>Auto-closes: <strong>{new Date(position.autoCloseTime).toLocaleString()}</strong></p>

          <button onClick={handleClose} disabled={loading}>
            Close Position
          </button>
        </div>
      )}
    </div>
  );
}
