# Deployment Guide

## Repository Created

Complete SDK package ready for GitHub and npm publication.

## Structure

```
forecast-leverage-sdk/
├── src/
│   ├── index.ts         # Exports
│   ├── types.ts         # Type definitions
│   ├── errors.ts        # Error classes
│   └── sdk.ts           # Main SDK (562 lines)
├── test/
│   └── integrator.test.ts    # 19 tests
├── examples/
│   ├── basic.ts         # Open/close positions
│   ├── simulation.ts    # Compare scenarios
│   ├── errors.ts        # Error handling
│   └── ui.tsx           # React component
├── docs/
│   └── API.md           # Complete API reference
├── .github/workflows/
│   ├── test.yml         # CI testing
│   └── publish.yml      # npm publishing
├── package.json
├── tsconfig.json
├── .gitignore
├── .npmignore
├── LICENSE              # MIT
└── README.md            # Main documentation
```

## Deployment Steps

### 1. Create GitHub Repository

```bash
cd /tmp/forecast-sdk-clean

# Create repo
gh repo create Genmin/forecast-leverage-sdk --public \
  --description "Add leverage to Polymarket trading"

# Add remote
git remote add origin git@github.com:Genmin/forecast-leverage-sdk.git
```

### 2. Initial Commit

```bash
git add .
git commit -m "Initial release v1.0.0

- Leverage SDK
- Target-based UX
- Input validation
- 19 test suite
- Documentation
- CI/CD configured"

git push -u origin main
```

### 3. Publish to npm

```bash
# Login
npm login

# Publish
npm publish --access public
```

### 4. Create Release

```bash
gh release create v1.0.0 \
  --title "v1.0.0 - Initial Release" \
  --notes "First stable release of Forecast Leverage SDK"
```

## Post-Deployment

### Configure Repository

1. **Topics**: Add for discoverability
   - `polymarket`
   - `leverage`
   - `prediction-markets`
   - `defi`
   - `sdk`

2. **Branch Protection**:
   - Require PR reviews
   - Require CI passing
   - No force push to main

3. **Secrets**:
   - Add `NPM_TOKEN` for automated publishing

### Test Installation

```bash
# In a test project
npm install @forecast-protocol/leverage-sdk

# Verify
node -e "console.log(require('@forecast-protocol/leverage-sdk'))"
```

## Maintenance

### Release Process

1. Make changes in feature branch
2. Update version in package.json
3. Update CHANGELOG.md
4. Create PR
5. Merge after CI passes
6. Tag release: `git tag v1.x.x`
7. Push tags: `git push --tags`
8. GitHub Actions auto-publishes to npm

### Support

- Issues: GitHub Issues
- Questions: GitHub Discussions
- Discord: discord.gg/forecast
- Email: dev@forecast.com
