# RPC Configuration Guide

## How RPC URLs Work in x402 AI Agent

### Default Behavior

By default, **you don't need to configure an RPC URL**. The agent uses the default x402 facilitator service at `https://x402.org/facilitator`, which handles all blockchain interactions for you:

```
Your Agent → x402 Facilitator → Blockchain (via Facilitator's RPC)
```

The facilitator service:
- Manages RPC connections
- Verifies payment signatures
- Executes blockchain transactions
- Handles gas management
- Returns transaction receipts

### Architecture Overview

```
┌─────────────────┐
│   Your Agent    │
│  (server.ts)    │
└────────┬────────┘
         │
         │ Payment verification/settlement
         ▼
┌─────────────────┐
│  Facilitator    │
│ (x402.org or    │
│   custom)       │
└────────┬────────┘
         │
         │ RPC calls
         ▼
┌─────────────────┐
│   Blockchain    │
│ (Base, Polygon, │
│   etc.)         │
└─────────────────┘
```

## Configuration Options

### Option 1: Default (Recommended)

**No configuration needed!** Just leave `.env` as is:

```env
# No FACILITATOR_URL needed
# Uses https://x402.org/facilitator by default
```

The default facilitator handles everything for you.

### Option 2: Custom Facilitator

If you want to use a different facilitator service, set:

```env
FACILITATOR_URL=https://your-custom-facilitator.com
FACILITATOR_API_KEY=your_api_key_if_required
```

Your custom facilitator would need to implement the x402 facilitator API:
- `POST /verify` - Verify payment signatures
- `POST /settle` - Settle payments on-chain

### Option 3: Self-Hosted Facilitator

To run your own facilitator with custom RPC:

1. **Deploy your own facilitator service** (see x402 facilitator repo)
2. **Configure the facilitator** with your RPC URL:
   ```env
   # In your facilitator's config
   RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
   ```
3. **Point your agent to your facilitator**:
   ```env
   # In agent/.env
   FACILITATOR_URL=https://your-facilitator.yoursite.com
   ```

### Option 4: Direct Blockchain Integration (Advanced)

If you want to bypass the facilitator and interact with the blockchain directly, you would need to:

1. Create a custom `FacilitatorClient` implementation
2. Use ethers.js with your RPC URL
3. Implement payment verification and settlement logic

Example custom facilitator:

Our reference implementation (`src/MerchantExecutor.ts`) already handles this by using the core `x402` types together with `ethers`:

- If you set `PRIVATE_KEY` (and optionally `RPC_URL`), the agent verifies the EIP-3009 payload locally and submits `transferWithAuthorization` directly to USDC.
- If you omit those variables, the server will still verify signatures but will skip settlement (so you can plug in your own flow).

Use this file as a starting point if you want to customise the behaviour (e.g. support additional assets or add logging). The implementation relies on:

```typescript
import type { PaymentPayload, PaymentRequirements, VerifyResponse, SettleResponse } from 'x402/types';
import { ethers } from 'ethers';
```

From there you can adapt the verification/settlement helpers to fit your architecture.

## RPC Providers

If you need to configure an RPC URL (for custom facilitator or direct integration), here are popular providers:

### Alchemy
```env
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_API_KEY
```
Sign up: https://www.alchemy.com

### Infura
```env
RPC_URL=https://base-sepolia.infura.io/v3/YOUR_PROJECT_ID
```
Sign up: https://www.infura.io

### QuickNode
```env
RPC_URL=https://your-endpoint.base-sepolia.quiknode.pro/YOUR_TOKEN/
```
Sign up: https://www.quicknode.com

### Public RPCs (Not recommended for production)
```env
# Base Sepolia
RPC_URL=https://sepolia.base.org

# Base Mainnet
RPC_URL=https://mainnet.base.org
```

## Network-Specific RPC URLs

### Base Sepolia (Testnet)
- Alchemy: `https://base-sepolia.g.alchemy.com/v2/YOUR_KEY`
- Public: `https://sepolia.base.org`
- Chain ID: 84532

### Base Mainnet
- Alchemy: `https://base-mainnet.g.alchemy.com/v2/YOUR_KEY`
- Public: `https://mainnet.base.org`
- Chain ID: 8453

### Polygon Amoy (Testnet)
- Alchemy: `https://polygon-amoy.g.alchemy.com/v2/YOUR_KEY`
- Chain ID: 80002

### Ethereum Sepolia
- Alchemy: `https://eth-sepolia.g.alchemy.com/v2/YOUR_KEY`
- Infura: `https://sepolia.infura.io/v3/YOUR_PROJECT_ID`
- Chain ID: 11155111

## Current Implementation

The agent currently uses:

**File: agent/src/server.ts**
```typescript
// Initialize facilitator (optional custom configuration)
let facilitator: FacilitatorClient | undefined;
if (FACILITATOR_URL) {
  facilitator = new DefaultFacilitatorClient({
    url: FACILITATOR_URL,
    apiKey: FACILITATOR_API_KEY,
  });
  console.log(`🔧 Using custom facilitator: ${FACILITATOR_URL}`);
} else {
  console.log('🔧 Using default facilitator: https://x402.org/facilitator');
}
```

## Recommendations

### For Development/Testing
✅ **Use the default facilitator** (`https://x402.org/facilitator`)
- No configuration needed
- Works out of the box
- Handles testnet transactions

### For Production
Consider these options:

1. **Default facilitator** (easiest)
   - Managed service
   - No infrastructure to maintain
   - May have rate limits

2. **Custom facilitator** (recommended)
   - Your own RPC endpoints
   - Better control and monitoring
   - Can optimize for your needs
   - Set up failover/redundancy

3. **Direct integration** (advanced)
   - Maximum control
   - Requires blockchain expertise
   - More maintenance

## Troubleshooting

### "Network error" during payment
- Check facilitator URL is accessible
- Verify API key if using custom facilitator
- Check RPC endpoint is responding (if self-hosting)

### "Settlement failed"
- Ensure RPC URL matches network
- Check wallet has gas tokens
- Verify RPC endpoint rate limits

### "Invalid signature"
- Network mismatch (e.g., mainnet signature on testnet)
- Check NETWORK env variable matches RPC network

## Summary

**Quick Answer:**
- RPC URL is **not required** for basic setup
- The default facilitator at `https://x402.org/facilitator` handles blockchain interactions
- Only configure RPC if you're running a custom facilitator or doing direct blockchain integration

**Environment Variables:**
```env
# Required
OPENAI_API_KEY=your_key
PAY_TO_ADDRESS=0xYourAddress

# Optional - only if using custom facilitator
FACILITATOR_URL=https://your-facilitator.com
FACILITATOR_API_KEY=your_key

# Optional - only if implementing custom blockchain interaction
RPC_URL=https://base-sepolia.g.alchemy.com/v2/YOUR_KEY
PRIVATE_KEY=your_private_key
```
