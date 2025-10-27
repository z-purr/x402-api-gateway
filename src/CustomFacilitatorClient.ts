import {
  FacilitatorClient,
  PaymentPayload,
  PaymentRequirements,
  VerifyResponse,
  SettleResponse,
} from 'a2a-x402';

/**
 * Custom Facilitator Client with enhanced redirect handling and debugging
 */
export class CustomFacilitatorClient implements FacilitatorClient {
  private config: {
    url: string;
    apiKey?: string;
  };

  constructor(config?: { url?: string; apiKey?: string }) {
    const url = config?.url || 'https://x402.org/facilitator';

    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      throw new Error(`Invalid URL ${url}, must start with http:// or https://`);
    }

    this.config = {
      url: url.endsWith('/') ? url.slice(0, -1) : url,
      apiKey: config?.apiKey,
    };
  }

  async verify(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<VerifyResponse> {
    try {
      const requestBody = {
        x402Version: payload.x402Version,
        paymentPayload: payload,
        paymentRequirements: requirements,
      };

      console.log('\n[CustomFacilitator] Sending verify request...');
      console.log(`[CustomFacilitator] URL: ${this.config.url}/verify`);
      console.log(`[CustomFacilitator] Request body:`, JSON.stringify(requestBody, null, 2));

      const response = await fetch(`${this.config.url}/verify`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
        },
        body: JSON.stringify(requestBody),
        redirect: 'follow', // Explicitly follow redirects
      });

      console.log(`[CustomFacilitator] Response status: ${response.status} ${response.statusText}`);
      console.log(`[CustomFacilitator] Response URL: ${response.url}`);

      if (!response.ok) {
        // Try to get response body for more details
        let errorDetails = '';
        try {
          const errorBody = await response.text();
          errorDetails = errorBody ? `: ${errorBody}` : '';
        } catch (e) {
          // Ignore if we can't read the body
        }

        return {
          isValid: false,
          invalidReason: `HTTP ${response.status}: ${response.statusText}${errorDetails}`,
        };
      }

      const data = await response.json() as any;
      console.log(`[CustomFacilitator] Response data:`, JSON.stringify(data, null, 2));

      return {
        isValid: data.isValid || data.is_valid || false,
        payer: data.payer,
        invalidReason: data.invalidReason || data.invalid_reason,
      };
    } catch (error) {
      console.error('[CustomFacilitator] Error during verify:', error);
      return {
        isValid: false,
        invalidReason: `Network error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  async settle(
    payload: PaymentPayload,
    requirements: PaymentRequirements
  ): Promise<SettleResponse> {
    try {
      const requestBody = {
        x402Version: payload.x402Version,
        paymentPayload: payload,
        paymentRequirements: requirements,
      };

      console.log('\n[CustomFacilitator] Sending settle request...');
      console.log(`[CustomFacilitator] URL: ${this.config.url}/settle`);

      const response = await fetch(`${this.config.url}/settle`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey && { 'Authorization': `Bearer ${this.config.apiKey}` }),
        },
        body: JSON.stringify(requestBody),
        redirect: 'follow', // Explicitly follow redirects
      });

      console.log(`[CustomFacilitator] Response status: ${response.status} ${response.statusText}`);
      console.log(`[CustomFacilitator] Response URL: ${response.url}`);

      if (!response.ok) {
        let errorDetails = '';
        try {
          const errorBody = await response.text();
          errorDetails = errorBody ? `: ${errorBody}` : '';
        } catch (e) {
          // Ignore
        }

        return {
          success: false,
          network: requirements.network,
          errorReason: `HTTP ${response.status}: ${response.statusText}${errorDetails}`,
        };
      }

      const data = await response.json() as any;
      console.log(`[CustomFacilitator] Response data:`, JSON.stringify(data, null, 2));

      return {
        success: data.success || false,
        transaction: data.transaction || data.transactionHash,
        network: data.network || requirements.network,
        payer: data.payer,
        errorReason: data.errorReason || data.error_reason,
      };
    } catch (error) {
      console.error('[CustomFacilitator] Error during settle:', error);
      return {
        success: false,
        network: requirements.network,
        errorReason: `Network error: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
