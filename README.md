# x402 AI Agent

A basic AI agent that charges $0.10 in USDC to process requests using the x402 payment protocol.

## Overview

This agent demonstrates how to integrate x402 payments with an AI service. It:

1. Receives user requests
2. Requires payment of $0.10 USDC before processing
3. Processes requests using OpenAI GPT-4
4. Returns AI-generated responses after payment is verified

## Architecture

The agent consists of four main components:

- **SimpleAgent**: Core agent logic that processes requests using OpenAI
- **MerchantExecutor**: Payment handling layer that extends `x402ServerExecutor`
- **CustomFacilitatorClient**: Enhanced facilitator client with redirect handling and debugging
- **Server**: Express HTTP server that exposes the agent endpoints

## Prerequisites

- Node.js 18 or higher
- A wallet with some ETH for gas fees (on your chosen network)
- An OpenAI API key
- A wallet address to receive USDC payments

## Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Copy the example environment file:

```bash
cp .env.example .env
```

Edit `.env` and fill in your values:

```env
# Server Configuration
PORT=3000

# Wallet Configuration
# Your Ethereum private key (without 0x prefix) - this wallet will receive USDC payments
PRIVATE_KEY=your_private_key_here

# Payment Configuration
# The wallet address that will receive payments (derived from PRIVATE_KEY)
PAY_TO_ADDRESS=0xYourWalletAddress

# Network Configuration
# Options: "base", "base-sepolia", "ethereum", "polygon", "polygon-amoy"
NETWORK=base-sepolia

# OpenAI Configuration
# Your OpenAI API key for AI processing
OPENAI_API_KEY=your_openai_api_key_here

# Optional: Custom Facilitator URL
# Default: https://x402.org/facilitator
# Set this if you want to use a custom facilitator or local instance
# FACILITATOR_URL=https://your-facilitator.com

# Optional: Facilitator API Key
# FACILITATOR_API_KEY=your_api_key

# Optional: RPC URL for direct blockchain interaction
# Set this (along with PRIVATE_KEY) to enable direct settlement without the hosted facilitator.
# If omitted and NETWORK is "base" or "base-sepolia", the agent will use Coinbase's public RPC.
# RPC_URL=https://base-sepolia.g.alchemy.com/v2/your-api-key

# Optional: Debug logging
X402_DEBUG=true
```

**Important:**
- `PAY_TO_ADDRESS` should be your wallet address where you want to receive USDC payments
- `NETWORK` should match where you want to receive payments (recommend `base-sepolia` for testing)
- Never commit your `.env` file to version control

**Direct Settlement:**
- If you set `PRIVATE_KEY` (and optionally `RPC_URL`), the agent bypasses the hosted facilitator
- It will verify the EIP-3009 signature locally with `ethers` and call `transferWithAuthorization()` on the USDC contract directly
- If `RPC_URL` is omitted, the agent will use public RPC endpoints for Base/Base Sepolia
- Remove `PRIVATE_KEY` to continue using the default facilitator

## Running the Agent

### Development Mode

```bash
npm run dev
```

### Production Mode

```bash
npm run build
npm start
```

The server will start on `http://localhost:3000` (or your configured PORT).

## Usage

### Health Check

Check if the agent is running:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "service": "x402-ai-agent",
  "version": "1.0.0",
  "payment": {
    "address": "0xYourAddress...",
    "network": "base-sepolia",
    "price": "$0.10"
  }
}
```

### Testing the Agent

We provide multiple ways to test the agent:

#### 1. Quick Test Script

Run the simple shell test:

```bash
./test-request.sh
```

This tests the health endpoint and payment requirement flow.

#### 2. Full Test Suite

Run the comprehensive test client:

```bash
npm test
```

This will:
- Check agent health
- Test unpaid requests (returns 402)
- Test paid requests (if CLIENT_PRIVATE_KEY is configured)
- Show the complete payment flow

See [TESTING.md](./TESTING.md) for detailed testing documentation.

#### 3. Manual Testing (Simple)

For quick testing without the full A2A protocol:

```bash
curl -X POST http://localhost:3000/test \
  -H "Content-Type: application/json" \
  -d '{"text": "Tell me a joke about programming"}'
```

This will return a payment required error since no payment was made.

#### Main Endpoint (A2A Compatible)

Send a request using the A2A message format:

```bash
curl -X POST http://localhost:3000/process \
  -H "Content-Type: application/json" \
  -d '{
    "message": {
      "parts": [
        {
          "kind": "text",
          "text": "What is the meaning of life?"
        }
      ]
    }
  }'
```

**Expected Response (402 Payment Required):**

```json
{
  "error": "Payment Required",
  "x402": {
    "x402Version": 1,
    "accepts": [
      {
        "scheme": "exact",
        "network": "base-sepolia",
        "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
        "payTo": "0xYourAddress...",
        "maxAmountRequired": "100000",
        "resource": "/process-request",
        "description": "AI request processing service",
        "mimeType": "application/json",
        "maxTimeoutSeconds": 3600,
        "extra": {
          "name": "USDC",
          "version": "2"
        }
      }
    ],
    "error": "Payment required for service: /process-request"
  }
}
```

To complete the payment and process the request, you'll need to:

1. Create a payment payload using the x402 client library
2. Sign the payment with your wallet
3. Submit the payment back to the `/process` endpoint

For a complete client example, see the a2a-x402 library documentation.

## How It Works

### Payment Flow

1. **Client sends request** → Agent receives the request
2. **Agent requires payment** → Returns 402 with payment requirements
3. **Client signs payment** → Creates EIP-3009 authorization
4. **Client submits payment** → Sends signed payment back to agent
5. **Agent verifies payment** → Checks signature and authorization
6. **Agent processes request** → Calls OpenAI API
7. **Agent settles payment** → Completes blockchain transaction
8. **Agent returns response** → Sends AI-generated response

### Payment Verification

The agent uses the x402 default facilitator (`https://x402.org/facilitator`) to:

- Verify payment signatures
- Check USDC allowances
- Execute the transfer on-chain

### Error Handling

- **Missing payment**: Returns 402 Payment Required
- **Invalid payment**: Returns payment verification failure
- **OpenAI error**: Returns error message in task status
- **Settlement failure**: Returns settlement error details

## Development

### Project Structure

```
agent/
├── src/
│   ├── server.ts                     # Express server and endpoints
│   ├── SimpleAgent.ts                # AI agent logic
│   ├── MerchantExecutor.ts           # Payment handling
│   ├── CustomFacilitatorClient.ts    # Enhanced facilitator client
│   └── testClient.ts                 # Test client for development
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── TESTING.md
└── test-agent.sh
```

### Building

```bash
npm run build
```

Compiled files will be in the `dist/` directory.

### Cleaning

```bash
npm run clean
```

## Testing with Real Payments

To test with real USDC payments:

1. Switch to a testnet (e.g., `base-sepolia`)
2. Get testnet USDC from a faucet
3. Use a client that implements the x402 protocol
4. Make sure your wallet has testnet ETH for gas

## Troubleshooting

### "OPENAI_API_KEY is required"

Make sure you've set `OPENAI_API_KEY` in your `.env` file.

### "PAY_TO_ADDRESS is required"

Make sure you've set `PAY_TO_ADDRESS` in your `.env` file to your wallet address.

### Payment verification fails

- Check that you're using the correct network
- Verify your wallet has USDC approval set
- Make sure the payment amount matches ($0.10)
- If the hosted facilitator returns `invalid_payload`, set `PRIVATE_KEY` and optionally `RPC_URL` to enable direct settlement
- To use a custom facilitator, set `FACILITATOR_URL` and optionally `FACILITATOR_API_KEY`

### OpenAI rate limits

If you hit OpenAI rate limits, consider:
- Using `gpt-3.5-turbo` instead of `gpt-4o-mini`
- Implementing request queuing
- Adding rate limiting to your agent

## Security Considerations

- Never commit your `.env` file
- Keep your private key secure
- Use testnet for development
- Validate all payment data before processing
- Implement rate limiting for production
- Monitor for failed payment attempts

## Next Steps

- Implement request queuing for high volume
- Add support for different payment tiers
- Create a web client interface
- Add analytics and monitoring
- Implement caching for common requests
- Add support for streaming responses

## License

ISC

## Resources

- [a2a-x402 Package on npm](https://www.npmjs.com/package/a2a-x402)
- [A2A Specification](https://github.com/google/a2a)
- [OpenAI API Documentation](https://platform.openai.com/docs)
