/**
 * Simple example of testing the x402 AI agent
 * This demonstrates basic usage of the test client
 */

import { TestClient } from '../src/testClient.js';

async function simpleTest() {
  console.log('🧪 Simple Agent Test\n');

  // Create a test client without a wallet (for testing payment requirements only)
  const client = new TestClient();

  // 1. Check if agent is healthy
  console.log('Step 1: Check agent health');
  await client.checkHealth();

  // 2. Send a request (will return payment required)
  console.log('\nStep 2: Send a test request');
  const response = await client.sendRequest('What is the capital of France?');

  if (response.x402) {
    console.log('\n✅ Payment requirement received!');
    console.log('Payment details:');
    const accepts = response.x402.accepts as any[];
    if (accepts && accepts.length > 0) {
      console.log(`  - Asset: ${accepts[0].asset}`);
      console.log(`  - Network: ${accepts[0].network}`);
      console.log(`  - Amount: ${accepts[0].maxAmountRequired} micro units`);
      console.log(`  - Pay to: ${accepts[0].payTo}`);
    }
  } else {
    console.log('❌ Expected payment requirement but got:', response);
  }
}

simpleTest().catch(console.error);
