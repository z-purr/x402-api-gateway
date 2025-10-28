import express from 'express';
import dotenv from 'dotenv';
import { SimpleAgent } from './SimpleAgent.js';
import { MerchantExecutor, type MerchantExecutorOptions } from './MerchantExecutor.js';
import type { PaymentPayload } from 'x402/types';
import {
  EventQueue,
  Message,
  RequestContext,
  Task,
  TaskState,
} from './x402Types.js';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// Configuration
const PORT = process.env.PORT || 3000;
const PRIVATE_KEY = process.env.PRIVATE_KEY;
const PAY_TO_ADDRESS = process.env.PAY_TO_ADDRESS;
const NETWORK = process.env.NETWORK || 'base-sepolia';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const RPC_URL = process.env.RPC_URL;

// Validate environment variables
if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is required');
  process.exit(1);
}

if (!PAY_TO_ADDRESS) {
  console.error('❌ PAY_TO_ADDRESS is required');
  process.exit(1);
}

const SUPPORTED_NETWORKS = ['base', 'base-sepolia', 'polygon', 'polygon-amoy'] as const;
if (!SUPPORTED_NETWORKS.includes(NETWORK as any)) {
  console.warn(
    `⚠️  Network "${NETWORK}" is not explicitly supported. Falling back to "base-sepolia".`
  );
}

const resolvedNetwork = SUPPORTED_NETWORKS.includes(NETWORK as any)
  ? (NETWORK as (typeof SUPPORTED_NETWORKS)[number])
  : ('base-sepolia' as (typeof SUPPORTED_NETWORKS)[number]);

// Initialize the agent stack
const simpleAgent = new SimpleAgent(OPENAI_API_KEY, PAY_TO_ADDRESS, resolvedNetwork);

const merchantOptions: MerchantExecutorOptions = {
  payToAddress: PAY_TO_ADDRESS,
  network: resolvedNetwork,
  price: 0.1,
  rpcUrl: RPC_URL,
  privateKey: PRIVATE_KEY,
};

const merchantExecutor = new MerchantExecutor(merchantOptions);
const paymentRequirements = merchantExecutor.getPaymentRequirements();

if (PRIVATE_KEY) {
  if (!RPC_URL) {
    console.log('⚡ Direct settlement enabled (using default RPC endpoint)');
  } else {
    console.log('⚡ Direct settlement enabled (custom RPC provided)');
  }
} else {
  console.log('🤝 No merchant private key configured. Payments will be verified but not settled automatically.');
}

console.log('🚀 x402 AI Agent initialized');
console.log(`💰 Payment address: ${PAY_TO_ADDRESS}`);
if (resolvedNetwork !== NETWORK) {
  console.log(`🌐 Network: ${resolvedNetwork} (requested: ${NETWORK})`);
} else {
  console.log(`🌐 Network: ${resolvedNetwork}`);
}
console.log(`💵 Price per request: $0.10 USDC`);

/**
 * Health check endpoint
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'x402-ai-agent',
    version: '1.0.0',
    payment: {
      address: PAY_TO_ADDRESS,
      network: NETWORK,
      price: '$0.10',
    },
  });
});

/**
 * Main endpoint to process AI requests
 * This endpoint accepts A2A-compatible task submissions
 */
app.post('/process', async (req, res) => {
  try {
    console.log('\n📥 Received request');
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Parse the incoming request
    const { message, taskId, contextId, metadata } = req.body;

    if (!message) {
      return res.status(400).json({
        error: 'Missing message in request body',
      });
    }

    // Create a task from the request
    const task: Task = {
      id: taskId || `task-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      contextId: contextId || `context-${Date.now()}`,
      status: {
        state: TaskState.INPUT_REQUIRED,
        message: message,
      },
      metadata: metadata || {},
    };

    // Create request context
    const context: RequestContext = {
      taskId: task.id,
      contextId: task.contextId,
      currentTask: task,
      message: message,
    };

    // Create event queue to collect responses
    const events: Task[] = [];
    const eventQueue: EventQueue = {
      enqueueEvent: async (event: Task) => {
        events.push(event);
      },
    };

    const paymentPayload = message.metadata?.['x402.payment.payload'] as
      | PaymentPayload
      | undefined;
    const paymentStatus = message.metadata?.['x402.payment.status'];

    if (!paymentPayload || paymentStatus !== 'payment-submitted') {
      const paymentRequired = merchantExecutor.createPaymentRequiredResponse();

      const responseMessage: Message = {
        messageId: `msg-${Date.now()}`,
        role: 'agent',
        parts: [
          {
            kind: 'text',
            text: 'Payment required. Please submit payment to continue.',
          },
        ],
        metadata: {
          'x402.payment.required': paymentRequired,
          'x402.payment.status': 'payment-required',
        },
      };

      task.status.state = TaskState.INPUT_REQUIRED;
      task.status.message = responseMessage;
      task.metadata = {
        ...(task.metadata || {}),
        'x402.payment.required': paymentRequired,
        'x402.payment.status': 'payment-required',
      };

      events.push(task);
      console.log('💰 Payment required for request processing');

      return res.json({
        success: false,
        error: 'Payment Required',
        task,
        events,
      });
    }

    const verifyResult = await merchantExecutor.verifyPayment(paymentPayload);

    if (!verifyResult.isValid) {
      const errorReason = verifyResult.invalidReason || 'Invalid payment';
      task.status.state = TaskState.FAILED;
      task.status.message = {
        messageId: `msg-${Date.now()}`,
        role: 'agent',
        parts: [
          {
            kind: 'text',
            text: `Payment verification failed: ${errorReason}`,
          },
        ],
        metadata: {
          'x402.payment.status': 'payment-rejected',
          'x402.payment.error': errorReason,
        },
      };
      task.metadata = {
        ...(task.metadata || {}),
        'x402.payment.status': 'payment-rejected',
        'x402.payment.error': errorReason,
      };

      events.push(task);

      return res.status(402).json({
        error: 'Payment verification failed',
        reason: errorReason,
        task,
        events,
      });
    }

    task.metadata = {
      ...(task.metadata || {}),
      'x402_payment_verified': true,
      'x402.payment.status': 'payment-verified',
      ...(verifyResult.payer ? { 'x402.payment.payer': verifyResult.payer } : {}),
    };

    await simpleAgent.execute(context, eventQueue);

    const settlement = await merchantExecutor.settlePayment(paymentPayload);

    task.metadata = {
      ...(task.metadata || {}),
      'x402.payment.status': settlement.success ? 'payment-completed' : 'payment-failed',
      ...(settlement.transaction
        ? { 'x402.payment.receipts': [settlement] }
        : {}),
      ...(settlement.errorReason
        ? { 'x402.payment.error': settlement.errorReason }
        : {}),
    };

    if (events.length === 0) {
      events.push(task);
    }

    console.log('📤 Sending response\n');

    return res.json({
      success: settlement.success,
      task: events[events.length - 1],
      events,
      settlement,
    });
  } catch (error: any) {
    console.error('❌ Error processing request:', error);

    return res.status(500).json({
      error: error.message || 'Internal server error',
    });
  }
});

/**
 * Simple test endpoint to try the agent
 */
app.post('/test', async (req, res) => {
  const message: Message = {
    messageId: `msg-${Date.now()}`,
    role: 'user',
    parts: [
      {
        kind: 'text',
        text: req.body.text || 'Hello, tell me a joke!',
      },
    ],
  };

  try {
    const response = await fetch(`http://localhost:${PORT}/process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ message }),
    });

    const data = await response.json();
    res.json(data);
  } catch (error: any) {
    res.status(500).json({
      error: error.message,
    });
  }
});

// Start the server
app.listen(PORT, () => {
  console.log(`\n✅ Server running on http://localhost:${PORT}`);
  console.log(`📖 Health check: http://localhost:${PORT}/health`);
  console.log(`🧪 Test endpoint: POST http://localhost:${PORT}/test`);
  console.log(`🚀 Main endpoint: POST http://localhost:${PORT}/process\n`);
});
