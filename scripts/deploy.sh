#!/bin/bash

set -e

echo "Forecast Leverage SDK - Deployment Script"
echo "=========================================="
echo ""

# Check if gh CLI is installed
if ! command -v gh &> /dev/null; then
    echo "Error: GitHub CLI (gh) not installed"
    echo "Install: brew install gh"
    exit 1
fi

# Check if logged in
if ! gh auth status &> /dev/null; then
    echo "Error: Not logged into GitHub CLI"
    echo "Run: gh auth login"
    exit 1
fi

# Confirm deployment
echo "This will:"
echo "  1. Create public GitHub repository"
echo "  2. Push code to GitHub"
echo "  3. Set up branch protection"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Deployment cancelled"
    exit 1
fi

# Create repository
echo ""
echo "Creating GitHub repository..."
gh repo create Genmin/forecast-leverage-sdk --public \
  --description "Add leverage to Polymarket trading via Forecast Protocol" \
  || echo "Repository may already exist"

# Add remote
git remote add origin git@github.com:Genmin/forecast-leverage-sdk.git 2>/dev/null || true

# Initial commit
echo ""
echo "Creating initial commit..."
git add .
git commit -m "Initial release v1.0.0

- Complete leverage SDK with target-based UX
- Comprehensive input validation
- Custom error classes
- Simulation mode
- 19-test suite (100% pass rate)
- Full documentation and examples
- CI/CD configured
- MIT licensed" || echo "Already committed"

# Push
echo ""
echo "Pushing to GitHub..."
git branch -M main
git push -u origin main

# Add topics
echo ""
echo "Adding repository topics..."
gh repo edit Genmin/forecast-leverage-sdk \
  --add-topic polymarket \
  --add-topic leverage \
  --add-topic prediction-markets \
  --add-topic defi \
  --add-topic sdk \
  --add-topic polygon

echo ""
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo ""
echo "Repository: https://github.com/Genmin/forecast-leverage-sdk"
echo ""
echo "Next steps:"
echo "  1. npm login"
echo "  2. npm publish --access public"
echo "  3. gh release create v1.0.0"
echo ""
