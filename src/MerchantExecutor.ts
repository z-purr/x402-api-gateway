import type { PaymentPayload, PaymentRequirements } from 'x402/types';
import { ethers } from 'ethers';

const TRANSFER_AUTH_TYPES = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
};

type SupportedNetwork = 'base' | 'base-sepolia' | 'polygon' | 'polygon-amoy';

const NETWORK_CONFIG: Record<
  SupportedNetwork,
  {
    chainId: number;
    usdcAddress: string;
    usdcName: string;
    explorer: string;
  }
> = {
  base: {
    chainId: 8453,
    usdcAddress: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    usdcName: 'USD Coin',
    explorer: 'https://basescan.org',
  },
  'base-sepolia': {
    chainId: 84532,
    usdcAddress: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
    usdcName: 'USDC',
    explorer: 'https://sepolia.basescan.org',
  },
  polygon: {
    chainId: 137,
    usdcAddress: '0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359',
    usdcName: 'USD Coin',
    explorer: 'https://polygonscan.com',
  },
  'polygon-amoy': {
    chainId: 80002,
    usdcAddress: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
    usdcName: 'USDC',
    explorer: 'https://amoy.polygonscan.com',
  },
};

export interface MerchantExecutorOptions {
  payToAddress: string;
  network: SupportedNetwork;
  price: number;
  rpcUrl?: string;
  privateKey?: string;
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
  private settlementProvider?: ethers.JsonRpcProvider;
  private settlementWallet?: ethers.Wallet;

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
      resource: '/process-request',
      description: 'AI request processing service',
      mimeType: 'application/json',
      maxTimeoutSeconds: 600,
      extra: {
        name: networkConfig.usdcName,
        version: '2',
      },
    };

    if (options.privateKey) {
      const normalizedKey = options.privateKey.startsWith('0x')
        ? options.privateKey
        : `0x${options.privateKey}`;

      const rpcUrl =
        options.rpcUrl || this.getDefaultRpcUrl(options.network);

      if (!rpcUrl) {
        console.warn(
          `⚠️  No RPC URL available for network "${options.network}". Direct settlement disabled.`
        );
        return;
      }

      try {
        this.settlementProvider = new ethers.JsonRpcProvider(rpcUrl);
        this.settlementWallet = new ethers.Wallet(
          normalizedKey,
          this.settlementProvider
        );
        console.log('⚡ Direct settlement enabled via RPC provider');
      } catch (error) {
        console.warn(
          '⚠️  Failed to initialize direct settlement. Payments will not settle automatically:',
          error
        );
      }
    }
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

    const result = this.verifyPaymentLocally(payload, this.requirements);

    console.log('\n📋 Verification result:');
    console.log(`   Valid: ${result.isValid}`);
    if (!result.isValid) {
      console.log(`   ❌ Reason: ${result.invalidReason}`);
    }

    return result;
  }

  async settlePayment(payload: PaymentPayload): Promise<SettlementResult> {
    console.log('\n💰 Settling payment...');
    console.log(`   Network: ${this.requirements.network}`);
    console.log(
      `   Amount: ${this.requirements.maxAmountRequired} (micro units)`
    );
    console.log(`   Pay to: ${this.requirements.payTo}`);

    if (!this.settlementWallet || !this.settlementProvider) {
      return {
        success: false,
        network: this.requirements.network,
        errorReason:
          'Settlement wallet not configured. Provide PRIVATE_KEY to enable settlement.',
      };
    }

    const result = await this.settleOnChain(payload, this.requirements);

    console.log('\n✅ Payment settlement result:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Network: ${result.network}`);
    if (result.transaction) {
      console.log(`   Transaction: ${result.transaction}`);
      if (this.explorerUrl) {
        console.log(`   Explorer: ${this.explorerUrl}/tx/${result.transaction}`);
      }
    }
    if (result.payer) {
      console.log(`   Payer: ${result.payer}`);
    }
    if (result.errorReason) {
      console.log(`   Error: ${result.errorReason}`);
    }

    return result;
  }

  private verifyPaymentLocally(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): VerifyResult {
    const exactPayload = payload.payload as any;
    const authorization = exactPayload?.authorization;
    const signature = exactPayload?.signature;

    if (!authorization || !signature) {
      return {
        isValid: false,
        invalidReason: 'Missing payment authorization data',
      };
    }

    if (payload.network !== requirements.network) {
      return {
        isValid: false,
        invalidReason: `Network mismatch: ${payload.network} vs ${requirements.network}`,
      };
    }

    if (
      authorization.to?.toLowerCase() !==
      requirements.payTo.toLowerCase()
    ) {
      return {
        isValid: false,
        invalidReason: 'Authorization recipient does not match payment requirement',
      };
    }

    try {
      const requiredAmount = BigInt(requirements.maxAmountRequired);
      const authorizedAmount = BigInt(authorization.value);
      if (authorizedAmount < requiredAmount) {
        return {
          isValid: false,
          invalidReason: 'Authorized amount is less than required amount',
        };
      }
    } catch {
      return {
        isValid: false,
        invalidReason: 'Invalid payment amount provided',
      };
    }

    const validAfterNum = Number(authorization.validAfter ?? 0);
    const validBeforeNum = Number(authorization.validBefore ?? 0);
    if (Number.isNaN(validAfterNum) || Number.isNaN(validBeforeNum)) {
      return {
        isValid: false,
        invalidReason: 'Invalid authorization timing fields',
      };
    }

    const now = Math.floor(Date.now() / 1000);
    if (validAfterNum > now) {
      return {
        isValid: false,
        invalidReason: 'Payment authorization is not yet valid',
      };
    }
    if (validBeforeNum <= now) {
      return {
        isValid: false,
        invalidReason: 'Payment authorization has expired',
      };
    }

    try {
      const domain = this.buildEip712Domain(requirements);
      const recovered = ethers.verifyTypedData(
        domain,
        TRANSFER_AUTH_TYPES,
        {
          from: authorization.from,
          to: authorization.to,
          value: authorization.value,
          validAfter: authorization.validAfter,
          validBefore: authorization.validBefore,
          nonce: authorization.nonce,
        },
        signature
      );

      if (recovered.toLowerCase() !== authorization.from.toLowerCase()) {
        return {
          isValid: false,
          invalidReason: 'Signature does not match payer address',
        };
      }

      return {
        isValid: true,
        payer: recovered,
      };
    } catch (error) {
      return {
        isValid: false,
        invalidReason: `Signature verification failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      };
    }
  }

  private async settleOnChain(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettlementResult> {
    if (!this.settlementWallet) {
      return {
        success: false,
        network: requirements.network,
        errorReason: 'Settlement wallet not configured',
      };
    }

    const exactPayload = payload.payload as any;
    const authorization = exactPayload?.authorization;
    const signature = exactPayload?.signature;

    if (!authorization || !signature) {
      return {
        success: false,
        network: requirements.network,
        errorReason: 'Missing payment authorization data',
      };
    }

    try {
      const usdcContract = new ethers.Contract(
        requirements.asset,
        [
          'function transferWithAuthorization(' +
            'address from,' +
            'address to,' +
            'uint256 value,' +
            'uint256 validAfter,' +
            'uint256 validBefore,' +
            'bytes32 nonce,' +
            'uint8 v,' +
            'bytes32 r,' +
            'bytes32 s' +
          ') external returns (bool)',
        ],
        this.settlementWallet
      );

      const parsedSignature = ethers.Signature.from(signature);
      const tx = await usdcContract.transferWithAuthorization(
        authorization.from,
        authorization.to,
        authorization.value,
        authorization.validAfter,
        authorization.validBefore,
        authorization.nonce,
        parsedSignature.v,
        parsedSignature.r,
        parsedSignature.s
      );

      const receipt = await tx.wait();
      const success = receipt?.status === 1;

      return {
        success,
        transaction: receipt?.hash,
        network: requirements.network,
        payer: authorization.from,
        errorReason: success ? undefined : 'Transaction reverted',
      };
    } catch (error) {
      return {
        success: false,
        network: requirements.network,
        payer: authorization.from,
        errorReason:
          error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildEip712Domain(requirements: PaymentRequirements) {
    const config = NETWORK_CONFIG[requirements.network as SupportedNetwork];
    if (!config) {
      throw new Error(
        `Unsupported network "${requirements.network}" for direct settlement`
      );
    }

    return {
      name: requirements.extra?.name || config.usdcName,
      version: requirements.extra?.version || '2',
      chainId: config.chainId,
      verifyingContract: requirements.asset,
    };
  }

  private getAtomicAmount(priceUsd: number): string {
    const atomicUnits = Math.floor(priceUsd * 1_000_000);
    return atomicUnits.toString();
  }

  private getDefaultRpcUrl(network: SupportedNetwork): string | undefined {
    switch (network) {
      case 'base':
        return 'https://mainnet.base.org';
      case 'base-sepolia':
        return 'https://sepolia.base.org';
      case 'polygon':
        return 'https://polygon-rpc.com';
      case 'polygon-amoy':
        return 'https://rpc-amoy.polygon.technology';
      default:
        return undefined;
    }
  }
}
