import type { PaymentPayload, PaymentRequirements } from 'x402/types';

const DEFAULT_FACILITATOR_URL = 'https://x402.org/facilitator';

type SupportedNetwork = 'base' | 'base-sepolia' | 'polygon' | 'polygon-amoy';

const NETWORK_CONFIG: Record<
  SupportedNetwork,
  {
    usdcAddress: string;
    usdcName: string;
    explorer: string;
  }
> = {
  base: {
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcName: 'USD Coin',
    explorer: 'https://basescan.org',
  },
  'base-sepolia': {
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcName: 'USDC',
    explorer: 'https://sepolia.basescan.org',
  },
  polygon: {
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    usdcName: 'USD Coin',
    explorer: 'https://polygonscan.com',
  },
  'polygon-amoy': {
    usdcAddress: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    usdcName: 'USDC',
    explorer: 'https://amoy.polygonscan.com',
  },
};

export interface MerchantExecutorOptions {
  payToAddress: string;
  network: SupportedNetwork;
  price: number;
  facilitatorUrl?: string;
  facilitatorApiKey?: string;
  resourceUrl?: string;
}

export interface VerifyResult {
  isValid: boolean;
  payer?: string;
  invalidReason?: string;
}

export interface SettlementResult {
  success: boolean;
  transaction?: string;
  network: string;
  payer?: string;
  errorReason?: string;
}

export class MerchantExecutor {
  private readonly requirements: PaymentRequirements;
  private readonly explorerUrl?: string;
  private readonly facilitatorUrl: string;
  private readonly facilitatorApiKey?: string;

  constructor(options: MerchantExecutorOptions) {
    const networkConfig = NETWORK_CONFIG[options.network];

    if (!networkConfig) {
      throw new Error(`Unsupported network "${options.network}"`);
    }

    this.explorerUrl = networkConfig.explorer;

    this.requirements = {
      scheme: 'exact',
      network: options.network,
      asset: networkConfig.usdcAddress,
      payTo: options.payToAddress,
      maxAmountRequired: this.getAtomicAmount(options.price),
      resource: options.resourceUrl || 'https://merchant.local/process',
      description: 'AI request processing service',
      mimeType: 'application/json',
      maxTimeoutSeconds: 600,
      extra: {
        name: networkConfig.usdcName,
        version: '2',
      },
    };

    this.facilitatorUrl = options.facilitatorUrl || DEFAULT_FACILITATOR_URL;
    this.facilitatorApiKey = options.facilitatorApiKey;
  }

  getPaymentRequirements(): PaymentRequirements {
    return this.requirements;
  }

  createPaymentRequiredResponse() {
    return {
      x402Version: 1,
      accepts: [this.requirements],
      error: 'Payment required for service: /process-request',
    };
  }

  async verifyPayment(payload: PaymentPayload): Promise<VerifyResult> {
    console.log('\n🔍 Verifying payment...');
    console.log(`   Network: ${payload.network}`);
    console.log(`   Scheme: ${payload.scheme}`);
    console.log(`   From: ${(payload.payload as any).authorization?.from}`);
    console.log(`   To: ${this.requirements.payTo}`);
    console.log(`   Amount: ${this.requirements.maxAmountRequired}`);

    try {
      const response = await this.callFacilitator<VerifyResult>('verify', payload);

      console.log('\n📋 Verification result:');
      console.log(`   Valid: ${response.isValid}`);
      if (!response.isValid) {
        console.log(`   ❌ Reason: ${response.invalidReason}`);
      }

      return response;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown verification error';
      console.error(`   ❌ Verification failed: ${message}`);
      return {
        isValid: false,
        invalidReason: message,
      };
    }
  }

  async settlePayment(payload: PaymentPayload): Promise<SettlementResult> {
    console.log('\n💰 Settling payment...');
    console.log(`   Network: ${this.requirements.network}`);
    console.log(
      `   Amount: ${this.requirements.maxAmountRequired} (micro units)`
    );
    console.log(`   Pay to: ${this.requirements.payTo}`);

    try {
      const result = await this.callFacilitator<SettlementResult>(
        'settle',
        payload
      );

      console.log('\n✅ Payment settlement result:');
      console.log(`   Success: ${result.success}`);
      console.log(`   Network: ${result.network}`);
      if (result.transaction) {
        console.log(`   Transaction: ${result.transaction}`);
        if (this.explorerUrl) {
          console.log(
            `   Explorer: ${this.explorerUrl}/tx/${result.transaction}`
          );
        }
      }
      if (result.payer) {
        console.log(`   Payer: ${result.payer}`);
      }
      if (result.errorReason) {
        console.log(`   Error: ${result.errorReason}`);
      }

      return result;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Unknown settlement error';
      console.error(`   ❌ Settlement failed: ${message}`);
      return {
        success: false,
        network: this.requirements.network,
        errorReason: message,
      };
    }
  }

  private getAtomicAmount(priceUsd: number): string {
    const atomicUnits = Math.floor(priceUsd * 1_000_000);
    return atomicUnits.toString();
  }

  private buildHeaders() {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.facilitatorApiKey) {
      headers.Authorization = `Bearer ${this.facilitatorApiKey}`;
    }

    return headers;
  }

  private async callFacilitator<T>(
    endpoint: 'verify' | 'settle',
    payload: PaymentPayload
  ): Promise<T> {
    const response = await fetch(`${this.facilitatorUrl}/${endpoint}`, {
      method: 'POST',
      headers: this.buildHeaders(),
      body: JSON.stringify({
        x402Version: payload.x402Version ?? 1,
        paymentPayload: payload,
        paymentRequirements: this.requirements,
      }),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(
        `Facilitator ${endpoint} failed (${response.status}): ${text || response.statusText
        }`
      );
    }

    return (await response.json()) as T;
  }
}
