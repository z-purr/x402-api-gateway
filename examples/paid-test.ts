/**
 * Example of testing the x402 AI agent with actual payment
 * This demonstrates the complete payment flow
 *
 * Prerequisites:
 * - Set CLIENT_PRIVATE_KEY in .env
 * - Test wallet must have USDC and gas tokens
 * - PRIVATE_KEY configured in the agent for settlement (or manual follow-up)
 */

import { TestClient } from '../src/testClient.js';
import dotenv from 'dotenv';

dotenv.config();

async function paidTest() {
  const privateKey = process.env.CLIENT_PRIVATE_KEY;

  if (!privateKey) {
    console.error('❌ CLIENT_PRIVATE_KEY not set in .env');
    console.log('\nTo test with payments:');
    console.log('1. Add CLIENT_PRIVATE_KEY=your_private_key to .env');
    console.log('2. Ensure wallet has USDC and gas tokens');
    console.log('3. (Optional) Provide RPC_URL if you prefer a custom provider');
    process.exit(1);
  }

  console.log('🧪 Paid Request Test\n');

  // Create a test client with wallet
  const client = new TestClient(privateKey);

  try {
    // Send a paid request
    console.log('Sending paid request...\n');
    const response = await client.sendPaidRequest(
      'Explain how the x402 payment protocol works in one sentence.'
    );

    if (response.success && response.task) {
      console.log('\n🎉 SUCCESS!');
      console.log('AI Response:');
      console.log('═'.repeat(60));

      const aiResponse = response.task.status.message?.parts
        ?.filter((p: any) => p.kind === 'text')
        .map((p: any) => p.text)
        .join(' ');

      console.log(aiResponse);
      console.log('═'.repeat(60));

      // Check for payment metadata
      if (response.task.metadata?.['x402.payment.receipts']) {
        const receipt = response.task.metadata['x402.payment.receipts'][0];
        console.log('\nPayment Receipt:');
        console.log(`  Transaction: ${receipt.transaction}`);
        console.log(`  Network: ${receipt.network}`);
        console.log(`  Payer: ${receipt.payer}`);
      }
    } else {
      console.log('❌ Request failed:', response.error || 'Unknown error');
    }
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

paidTest().catch(console.error);
