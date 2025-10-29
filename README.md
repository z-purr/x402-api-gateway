![x402 Starter Kit](header.jpg)

# x402 Starter Kit

A starter kit for building paid APIs using the x402 payment protocol. Includes an OpenAI integration as a demonstration example.

> To deploy to EigenCompute, follow [these steps](DEPLOYING_TO_EIGENCOMPUTE.md).

## Overview

This starter kit demonstrates how to build a paid API using x402 payments. It:

1. Receives API requests
2. Requires payment (of $0.10 USDC) before processing
3. Verifies and settles payments on-chain
4. Processes requests (using OpenAI as an example)
5. Returns responses after payment is confirmed

## Architecture

The API consists of three main components:

- **ExampleService**: Example service logic that processes requests using OpenAI (replace with your own service implementation)
- **MerchantExecutor**: Handles payment verification and settlement using `x402` types with direct EIP-3009 settlement via `ethers`
- **Server**: Express HTTP server that orchestrates payment validation and request processing

## Prerequisites

- Node.js 18 or higher
- A wallet with some ETH for gas fees (on your chosen network)
- An OpenAI API key (for the example implementation - replace with your own API)
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
# Your OpenAI API key for the example service (replace with your own API configuration)
OPENAI_API_KEY=your_openai_api_key_here

# Optional: RPC URL for direct blockchain interaction
# Set this (along with PRIVATE_KEY) to enable direct settlement.
# If omitted and NETWORK is "base" or "base-sepolia", the API will use Coinbase's public RPC.
# RPC_URL=https://base-sepolia.g.alchemy.com/v2/your-api-key

# Optional: Debug logging
X402_DEBUG=true
```

**Important:**
- `PAY_TO_ADDRESS` should be your wallet address where you want to receive USDC payments
- `NETWORK` should match where you want to receive payments (recommend `base-sepolia` for testing)
- Never commit your `.env` file to version control

**Direct Settlement:**
- If you set `PRIVATE_KEY` (and optionally `RPC_URL`), the API verifies the EIP-3009 signature locally with `ethers` and calls `transferWithAuthorization()` on the USDC contract directly
- If `RPC_URL` is omitted, the API will use public RPC endpoints for Base/Base Sepolia
- Omit `PRIVATE_KEY` to disable automatic settlement (payments remain verified but you can plug in your own settlement flow)

## Running the API

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

Check if the API is running:

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "healthy",
  "service": "x402-payment-api",
  "version": "1.0.0",
  "payment": {
    "address": "0xYourAddress...",
    "network": "base-sepolia",
    "price": "$0.10"
  }
}
```

### Testing the API

We provide multiple ways to test the API:

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
- Check API health
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

For a complete client example, see the [`x402` library documentation](https://www.npmjs.com/package/x402).

## How It Works

### Payment Flow

1. **Client sends request** → API receives the request
2. **API requires payment** → Returns 402 with payment requirements
3. **Client signs payment** → Creates EIP-3009 authorization
4. **Client submits payment** → Sends signed payment back to API
5. **API verifies payment** → Checks signature and authorization
6. **API processes request** → Calls your service (OpenAI in this example)
7. **API settles payment** → Completes blockchain transaction
8. **API returns response** → Sends the service response

### Payment Verification

`src/MerchantExecutor.ts` validates the EIP-3009 payload locally (using types from the `x402` package) before the request is processed. When a merchant private key is configured it also submits `transferWithAuthorization` on-chain via `ethers`, returning the resulting transaction hash for reference.

### Error Handling

- **Missing payment**: Returns 402 Payment Required
- **Invalid payment**: Returns payment verification failure
- **OpenAI error**: Returns error message in task status
- **Settlement failure**: Returns settlement error details

## Development

### Project Structure

```
x402-developer-starter-kit/
├── src/
│   ├── server.ts                     # Express server and endpoints
│   ├── ExampleService.ts             # Example service logic (replace with your own)
│   ├── MerchantExecutor.ts           # Payment verification & settlement helpers
│   ├── x402Types.ts                  # Shared task/message types
│   └── testClient.ts                 # Test client for development
├── package.json
├── tsconfig.json
├── .env.example
├── README.md
├── TESTING.md
└── test-request.sh
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
- If signature verification fails, review the logged invalid reason and confirm the client signed the latest payment requirements
- For settlement errors, ensure `PRIVATE_KEY` (and optionally `RPC_URL`) are set, or integrate a custom settlement flow tailored to your infrastructure

### OpenAI rate limits

If you hit OpenAI rate limits, consider:
- Using `gpt-3.5-turbo` instead of `gpt-4o-mini`
- Implementing request queuing
- Adding rate limiting to your API
- Replacing OpenAI with your own service

## Security Considerations

- Never commit your `.env` file
- Keep your private key secure
- Use testnet for development
- Validate all payment data before processing
- Implement rate limiting for production
- Monitor for failed payment attempts

## Next Steps

- Replace the example OpenAI service with your own API logic
- Implement request queuing for high volume
- Add support for different payment tiers
- Create a web client interface
- Add analytics and monitoring
- Implement caching for common requests
- Add support for streaming responses

## License

ISC

## Resources

- [x402 Package on npm](https://www.npmjs.com/package/x402)
- [A2A Specification](https://github.com/google/a2a)
- [OpenAI API Documentation](https://platform.openai.com/docs)
