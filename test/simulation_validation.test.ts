/**
 * Validation: Simulation loop math against geometric series formula
 */

// Test 1: Loop leverage calculation
function testLoopLeverage() {
  const F = 0.9;
  const capital = 1000;
  const price = 0.40;
  const loops = 10;

  // Simulate loop
  let total = 0;
  let usd = capital;
  for (let i = 0; i < loops; i++) {
    const tokens = usd / price;
    total += tokens;
    usd = tokens * F * price;  // CORRECT formula
    if (usd < 1) break;
  }

  // Expected (geometric series)
  const multiplier = (1 - Math.pow(F, loops)) / (1 - F);
  const expected = (capital / price) * multiplier;

  console.log('=== LOOP LEVERAGE TEST ===');
  console.log(`Capital: $${capital}, Price: ${price}, F: ${F}, Loops: ${loops}`);
  console.log('');
  console.log('Simulated:');
  console.log(`  Total tokens: ${total.toFixed(0)}`);
  console.log(`  Leverage: ${(total * price / capital).toFixed(2)}x`);
  console.log('');
  console.log('Expected (formula):');
  console.log(`  Total tokens: ${expected.toFixed(0)}`);
  console.log(`  Leverage: ${(expected * price / capital).toFixed(2)}x`);
  console.log(`  Multiplier: ${multiplier.toFixed(2)}x capital`);
  console.log('');

  const error = Math.abs(total - expected) / expected;
  const pass = error < 0.001;
  console.log(pass ? `PASS: ${(error * 100).toFixed(4)}% error` : `FAIL: ${(error * 100).toFixed(2)}% error`);
  console.log('');

  return pass;
}

// Test 2: Runway validation
function testRunway() {
  const F = 0.9;
  const R = 0.10;  // 10% APR
  const YEAR = 365 * 24 * 3600;

  // Runway formula: (1 - F) / (F * R) * year
  const runway = ((1 - F) / (F * R)) * YEAR;
  const safeRunway = runway * 0.95;

  console.log('=== RUNWAY VALIDATION TEST ===');
  console.log(`F: ${F}, R: ${R} (${(R * 100).toFixed(0)}% APR)`);
  console.log('');
  console.log(`Runway: ${(runway / 3600).toFixed(1)} hours`);
  console.log(`Safe runway (95%): ${(safeRunway / 3600).toFixed(1)} hours`);
  console.log('');

  // Verify debt at runway
  const tau = runway / YEAR;
  const debt = F * (1 + R * tau);
  console.log('Verification:');
  console.log(`  Debt at runway: ${debt.toFixed(4)} (should be ~1.00)`);
  console.log(`  Error: ${((debt - 1) * 100).toFixed(2)}%`);
  console.log('');

  const pass = Math.abs(debt - 1) < 0.001;
  console.log(pass ? 'PASS' : 'FAIL');
  console.log('');

  return pass;
}

// Test 3: Loop count formula
function testLoopCount() {
  const F = 0.9;

  // NEW: N = log(0.1) / log(F) to reach 90% of max
  const loops_new = Math.ceil(Math.log(0.1) / Math.log(F));

  // Verify: what leverage do we actually get?
  const maxLeverage = 1 / (1 - F);
  const actualMultiplier = (1 - Math.pow(F, loops_new)) / (1 - F);
  const target = maxLeverage * 0.9;

  console.log('=== LOOP COUNT TEST ===');
  console.log(`F: ${F}`);
  console.log(`Max leverage: ${maxLeverage.toFixed(2)}x capital`);
  console.log(`Target (90%): ${target.toFixed(2)}x capital`);
  console.log('');
  console.log('NEW formula:');
  console.log(`  Loops: ${loops_new}`);
  console.log(`  Actual multiplier: ${actualMultiplier.toFixed(2)}x`);
  console.log(`  vs target: ${((actualMultiplier / target - 1) * 100).toFixed(1)}% diff`);
  console.log('');

  const error = Math.abs(actualMultiplier - target) / target;
  const pass = error < 0.15;  // Allow 15% error (since we're rounding loops)
  console.log(pass ? `PASS: ${(error * 100).toFixed(1)}% error` : `FAIL: ${(error * 100).toFixed(1)}% error`);
  console.log('');

  return pass;
}

// Run all tests
console.log('\n');
console.log('╔════════════════════════════════════════╗');
console.log('║   SDK SIMULATION VALIDATION SUITE     ║');
console.log('╚════════════════════════════════════════╝');
console.log('\n');

const results = {
  'Loop leverage': testLoopLeverage(),
  'Runway validation': testRunway(),
  'Loop count': testLoopCount(),
};

console.log('');
console.log('═══════════════════════════════════════');
console.log('FINAL RESULTS');
console.log('═══════════════════════════════════════');

let passed = 0;
let failed = 0;

for (const [name, result] of Object.entries(results)) {
  console.log(`${name}: ${result ? 'PASS' : 'FAIL'}`);
  if (result) passed++;
  else failed++;
}

console.log('');
console.log(`${passed}/${passed + failed} tests passed`);
console.log('');

process.exit(failed > 0 ? 1 : 0);
