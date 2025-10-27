import express from 'express';
import dotenv from 'dotenv';
import { SimpleAgent } from './SimpleAgent.js';
import { MerchantExecutor } from './MerchantExecutor.js';
import { CustomFacilitatorClient } from './CustomFacilitatorClient.js';
import {
  RequestContext,
  EventQueue,
  Task,
  Message,
  TaskState,
  FacilitatorClient,
} from 'a2a-x402';

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
const FACILITATOR_URL = process.env.FACILITATOR_URL;
const FACILITATOR_API_KEY = process.env.FACILITATOR_API_KEY;
const RPC_URL = process.env.RPC_URL;

const DEFAULT_RPC_BY_NETWORK: Record<string, string> = {
  base: 'https://mainnet.base.org',
  'base-sepolia': 'https://sepolia.base.org',
};

// Validate environment variables
if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY is required');
  process.exit(1);
}

if (!PAY_TO_ADDRESS) {
  console.error('❌ PAY_TO_ADDRESS is required');
  process.exit(1);
}

// Initialize facilitator with custom client that handles redirects properly
const facilitator: FacilitatorClient = new CustomFacilitatorClient({
  url: FACILITATOR_URL || 'https://x402.org/facilitator',
  apiKey: FACILITATOR_API_KEY,
});

if (FACILITATOR_URL) {
  console.log(`🔧 Using custom facilitator: ${FACILITATOR_URL}`);
} else {
  console.log('🔧 Using default facilitator: https://x402.org/facilitator');
}

// Initialize the agent stack
const simpleAgent = new SimpleAgent(OPENAI_API_KEY, PAY_TO_ADDRESS, NETWORK);
const resolvedRpcUrl =
  PRIVATE_KEY && (RPC_URL || DEFAULT_RPC_BY_NETWORK[NETWORK as keyof typeof DEFAULT_RPC_BY_NETWORK]);

const directSettlementConfig =
  PRIVATE_KEY && resolvedRpcUrl
    ? {
        privateKey: PRIVATE_KEY,
        rpcUrl: resolvedRpcUrl,
      }
    : undefined;

if (directSettlementConfig) {
  if (!RPC_URL && DEFAULT_RPC_BY_NETWORK[NETWORK as keyof typeof DEFAULT_RPC_BY_NETWORK]) {
    console.log(
      `⚡ Direct settlement enabled using default RPC for ${NETWORK}: ${DEFAULT_RPC_BY_NETWORK[NETWORK as keyof typeof DEFAULT_RPC_BY_NETWORK]}`
    );
  } else {
    console.log('⚡ Direct settlement enabled (RPC + merchant key configured)');
  }
} else {
  console.log('🤝 Using facilitator for verification and settlement');
}

const merchantExecutor = new MerchantExecutor(
  simpleAgent,
  undefined,
  facilitator,
  directSettlementConfig
);

console.log('🚀 x402 AI Agent initialized');
console.log(`💰 Payment address: ${PAY_TO_ADDRESS}`);
console.log(`🌐 Network: ${NETWORK}`);
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

    // Execute the merchant executor
    await merchantExecutor.execute(context, eventQueue);

    // Return the response
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];

      console.log('📤 Sending response\n');

      return res.json({
        success: true,
        task: lastEvent,
        events: events,
      });
    }

    return res.json({
      success: true,
      message: 'Request processed',
    });
  } catch (error: any) {
    console.error('❌ Error processing request:', error);

    // Check if it's a payment required exception
    if (error.name === 'x402PaymentRequiredException') {
      console.log('💳 Payment required - sending payment request\n');

      return res.status(402).json({
        error: 'Payment Required',
        x402: {
          x402Version: 1,
          accepts: error.getAcceptsArray(),
          error: error.message,
        },
      });
    }

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
