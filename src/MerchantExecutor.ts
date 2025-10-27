import {
  x402ServerExecutor,
  verifyPayment,
  settlePayment,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
  FacilitatorClient,
  AgentExecutor,
  x402ExtensionConfig,
} from 'a2a-x402';
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

interface DirectSettlementConfig {
  rpcUrl?: string;
  privateKey?: string;
}

/**
 * MerchantExecutor handles payment verification and settlement for the AI agent
 * It extends x402ServerExecutor to integrate with the x402 payment protocol
 */
export class MerchantExecutor extends x402ServerExecutor {
  private facilitator?: FacilitatorClient;
  private settlementProvider?: ethers.JsonRpcProvider;
  private settlementWallet?: ethers.Wallet;
  private directSettlementEnabled = false;

  constructor(
    delegate: AgentExecutor,
    config?: Partial<x402ExtensionConfig>,
    facilitator?: FacilitatorClient,
    directSettlement?: DirectSettlementConfig
  ) {
    super(delegate, config);
    this.facilitator = facilitator;

    if (directSettlement?.rpcUrl && directSettlement?.privateKey) {
      try {
        const normalizedKey = directSettlement.privateKey.startsWith('0x')
          ? directSettlement.privateKey
          : `0x${directSettlement.privateKey}`;
        this.settlementProvider = new ethers.JsonRpcProvider(directSettlement.rpcUrl);
        this.settlementWallet = new ethers.Wallet(normalizedKey, this.settlementProvider);
        this.directSettlementEnabled = true;
        console.log('⚡ Direct settlement enabled via RPC provider');
      } catch (error) {
        console.warn('⚠️  Failed to initialize direct settlement, falling back to facilitator:', error);
        this.directSettlementEnabled = false;
      }
    }
  }

  /**
   * Verify the payment using the default facilitator or custom one
   */
  async verifyPayment(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    console.log('\n🔍 Verifying payment...');
    console.log(`   Facilitator: ${this.facilitator ? 'Custom' : 'Default (https://x402.org/facilitator)'}`);
    console.log(`   Network: ${payload.network}`);
    console.log(`   Scheme: ${payload.scheme}`);
    console.log(`   From: ${(payload.payload as any).authorization?.from}`);
    console.log(`   To: ${requirements.payTo}`);
    console.log(`   Amount: ${requirements.maxAmountRequired}`);

    try {
      if (this.directSettlementEnabled) {
        console.log('   Mode: Local verification (direct settlement enabled)');
        const result = this.verifyPaymentLocally(payload, requirements);
        console.log('\n📋 Verification result:');
        console.log(`   Valid: ${result.isValid}`);
        if (!result.isValid) {
          console.log(`   ❌ Reason: ${result.invalidReason}`);
        }
        return result;
      }

      const result = await verifyPayment(payload, requirements, this.facilitator);

      console.log('\n📋 Verification result:');
      console.log(`   Valid: ${result.isValid}`);
      if (!result.isValid) {
        console.log(`   ❌ Reason: ${result.invalidReason}`);
      }

      return result;
    } catch (error) {
      console.error('\n❌ Error during verification:', error);
      throw error;
    }
  }

  /**
   * Settle the payment using the default facilitator or custom one
   */
  async settlePayment(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    console.log('\n💰 Settling payment...');
    console.log(`   Network: ${requirements.network}`);
    console.log(`   Amount: ${requirements.maxAmountRequired} (micro units)`);
    console.log(`   Pay to: ${requirements.payTo}`);

    if (this.directSettlementEnabled) {
      console.log('   Mode: Direct on-chain settlement');
      const result = await this.settleOnChain(payload, requirements);

      console.log('\n✅ Payment settlement result:');
      console.log(`   Success: ${result.success}`);
      console.log(`   Network: ${result.network}`);
      if (result.transaction) {
        console.log(`   Transaction: ${result.transaction}`);
        const explorer = this.getExplorerUrl(requirements.network);
        if (explorer) {
          console.log(`   Explorer: ${explorer}/tx/${result.transaction}`);
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

    const result = await settlePayment(payload, requirements, this.facilitator);

    console.log('\n✅ Payment settlement result:');
    console.log(`   Success: ${result.success}`);
    console.log(`   Network: ${result.network}`);
      if (result.transaction) {
        console.log(`   Transaction: ${result.transaction}`);
        const explorer = this.getExplorerUrl(requirements.network);
        if (explorer) {
          console.log(`   Explorer: ${explorer}/tx/${result.transaction}`);
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

  /**
   * Perform EIP-3009 signature verification locally using ethers
   */
  private verifyPaymentLocally(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): VerifyResponse {
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

    if (authorization.to?.toLowerCase() !== requirements.payTo.toLowerCase()) {
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
      const recovered = ethers.verifyTypedData(domain, TRANSFER_AUTH_TYPES, {
        from: authorization.from,
        to: authorization.to,
        value: authorization.value,
        validAfter: authorization.validAfter,
        validBefore: authorization.validBefore,
        nonce: authorization.nonce,
      }, signature);

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
        invalidReason: `Signature verification failed: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Execute transferWithAuthorization directly on the USDC contract
   */
  private async settleOnChain(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    if (!this.settlementWallet || !this.settlementProvider) {
      return {
        success: false,
        network: requirements.network,
        errorReason: 'Direct settlement wallet not configured',
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
        errorReason: error instanceof Error ? error.message : String(error),
      };
    }
  }

  private buildEip712Domain(requirements: PaymentRequirements) {
    return {
      name: requirements.extra?.name || 'USDC',
      version: requirements.extra?.version || '2',
      chainId: this.getChainId(requirements.network),
      verifyingContract: requirements.asset,
    };
  }

  private getChainId(network: PaymentRequirements['network']) {
    const chainIds: Record<string, number> = {
      base: 8453,
      'base-sepolia': 84532,
      ethereum: 1,
      polygon: 137,
      'polygon-amoy': 80002,
    };

    const chainId = chainIds[network];

    if (!chainId) {
      throw new Error(`Unsupported network "${network}" for direct settlement`);
    }

    return chainId;
  }

  private getExplorerUrl(network: PaymentRequirements['network']) {
    const explorers: Record<string, string> = {
      base: 'https://basescan.org',
      'base-sepolia': 'https://sepolia.basescan.org',
      ethereum: 'https://etherscan.io',
      polygon: 'https://polygonscan.com',
      'polygon-amoy': 'https://amoy.polygonscan.com',
    };

    return explorers[network];
  }
}
