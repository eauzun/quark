/**
 * Quark AI Integration Adapter
 * ADR-001: Multi-provider free-tier AI strategy
 * 
 * Implements circuit breaker + fallback chain for:
 * 1. Google Gemini Flash (primary) — free tier
 * 2. Groq Llama 70B (adversarial) — free tier
 * 3. NVIDIA Nemotron (fallback) — trial credits
 * 4. Mistral Codestral (code-specific) — free experimental
 */

// ============================================================
// Types
// ============================================================

export interface AIProvider {
  readonly name: string;
  readonly baseUrl: string;
  readonly model: string;
  readonly maxRpm: number;
  readonly maxRpd: number;
  readonly maxTokens: number;
  readonly priority: number;
}

export interface AIRequest {
  system: string;
  messages: AIMessage[];
  temperature?: number;
  maxTokens?: number;
  responseFormat?: 'json' | 'text';
}

export interface AIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface AIResponse {
  content: string;
  model: string;
  provider: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
  };
  latencyMs: number;
}

export interface CircuitBreakerState {
  failures: number;
  lastFailure: number | null;
  state: 'closed' | 'open' | 'half-open';
  nextRetryAt: number | null;
}

// ============================================================
// Provider Configuration
// ============================================================

export const PROVIDERS: Record<string, AIProvider> = {
  'gemini-flash': {
    name: 'gemini-flash',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    model: 'gemini-2.0-flash', // Update to latest available
    maxRpm: 15,
    maxRpd: 500,
    maxTokens: 1_000_000,
    priority: 1,
  },
  'groq-llama': {
    name: 'groq-llama',
    baseUrl: 'https://api.groq.com/openai/v1',
    model: 'llama-3.3-70b-versatile',
    maxRpm: 30,
    maxRpd: 1000,
    maxTokens: 128_000,
    priority: 2,
  },
  'nemotron': {
    name: 'nemotron',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    model: 'nvidia/nemotron-4-340b-instruct',
    maxRpm: 40,
    maxRpd: 500,
    maxTokens: 4096,
    priority: 3,
  },
  'codestral': {
    name: 'codestral',
    baseUrl: 'https://codestral.mistral.ai/v1',
    model: 'codestral-latest',
    maxRpm: 20,
    maxRpd: 300,
    maxTokens: 32_000,
    priority: 4,
  },
} as const;

// ============================================================
// Task-to-Provider mapping (Spec §7)
// ============================================================

export type AITask =
  | 'scope_extraction'
  | 'primary_review'
  | 'adversarial_review'
  | 'challenge_generation'
  | 'interview_evaluation'
  | 'employer_assist'
  | 'heatmap_analysis';

export const TASK_PROVIDER_CHAIN: Record<AITask, string[]> = {
  scope_extraction: ['gemini-flash', 'nemotron', 'codestral'],
  primary_review: ['gemini-flash', 'codestral', 'groq-llama'],
  adversarial_review: ['groq-llama', 'gemini-flash', 'nemotron'],
  challenge_generation: ['gemini-flash', 'groq-llama', 'codestral'],
  interview_evaluation: ['gemini-flash', 'groq-llama'],
  employer_assist: ['gemini-flash', 'codestral'],
  heatmap_analysis: ['gemini-flash'],
};

// ============================================================
// Rate Limiter (Token Bucket)
// ============================================================

export interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

export class TokenBucketRateLimiter {
  private tokens: number;
  private lastRefill: number;

  constructor(private config: RateLimiterConfig) {
    this.tokens = config.maxRequests;
    this.lastRefill = Date.now();
  }

  canProceed(): boolean {
    this.refill();
    return this.tokens > 0;
  }

  consume(): boolean {
    this.refill();
    if (this.tokens <= 0) return false;
    this.tokens--;
    return true;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = Math.floor(
      (elapsed / this.config.windowMs) * this.config.maxRequests
    );
    if (tokensToAdd > 0) {
      this.tokens = Math.min(this.config.maxRequests, this.tokens + tokensToAdd);
      this.lastRefill = now;
    }
  }
}

// ============================================================
// Circuit Breaker
// ============================================================

const CIRCUIT_BREAKER_THRESHOLD = 5;
const CIRCUIT_BREAKER_RESET_MS = 60_000; // 1 minute

export class CircuitBreaker {
  private state: CircuitBreakerState = {
    failures: 0,
    lastFailure: null,
    state: 'closed',
    nextRetryAt: null,
  };

  isAvailable(): boolean {
    if (this.state.state === 'closed') return true;
    if (this.state.state === 'open') {
      if (this.state.nextRetryAt && Date.now() >= this.state.nextRetryAt) {
        this.state.state = 'half-open';
        return true;
      }
      return false;
    }
    // half-open: allow one request
    return true;
  }

  recordSuccess(): void {
    this.state = {
      failures: 0,
      lastFailure: null,
      state: 'closed',
      nextRetryAt: null,
    };
  }

  recordFailure(): void {
    this.state.failures++;
    this.state.lastFailure = Date.now();
    if (this.state.failures >= CIRCUIT_BREAKER_THRESHOLD) {
      this.state.state = 'open';
      this.state.nextRetryAt = Date.now() + CIRCUIT_BREAKER_RESET_MS;
    }
  }

  getState(): CircuitBreakerState {
    return { ...this.state };
  }
}

// ============================================================
// AI Service (Main Adapter)
// ============================================================

export interface AIServiceConfig {
  apiKeys: Record<string, string>;
  environment: 'development' | 'staging' | 'production';
}

/**
 * Main AI service with fallback chain, rate limiting, and circuit breaking.
 * 
 * SECURITY (Spec §7.1):
 * - All repository text, comments, README instructions and tool output are untrusted task data
 * - Prompt injection cannot change system policy, wallet, fee, permissions, or tool access
 * - No secrets in model context
 * - A model cannot call money-transfer tools
 */
export class AIService {
  private rateLimiters: Map<string, TokenBucketRateLimiter> = new Map();
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private dailyCounts: Map<string, { count: number; resetAt: number }> = new Map();

  constructor(private config: AIServiceConfig) {
    // Initialize rate limiters and circuit breakers for each provider
    for (const [name, provider] of Object.entries(PROVIDERS)) {
      this.rateLimiters.set(
        name,
        new TokenBucketRateLimiter({
          maxRequests: provider.maxRpm,
          windowMs: 60_000,
        })
      );
      this.circuitBreakers.set(name, new CircuitBreaker());
      this.dailyCounts.set(name, {
        count: 0,
        resetAt: this.getNextDayReset(),
      });
    }
  }

  /**
   * Execute an AI request with automatic fallback chain.
   * Tries providers in priority order based on task type.
   */
  async execute(task: AITask, request: AIRequest): Promise<AIResponse> {
    const providerChain = TASK_PROVIDER_CHAIN[task];
    const errors: Array<{ provider: string; error: string }> = [];

    for (const providerName of providerChain) {
      const provider = PROVIDERS[providerName];
      if (!provider) continue;

      const apiKey = this.config.apiKeys[providerName];
      if (!apiKey) continue;

      // Check circuit breaker
      const cb = this.circuitBreakers.get(providerName)!;
      if (!cb.isAvailable()) {
        errors.push({ provider: providerName, error: 'circuit_open' });
        continue;
      }

      // Check rate limit
      const rl = this.rateLimiters.get(providerName)!;
      if (!rl.canProceed()) {
        errors.push({ provider: providerName, error: 'rate_limited' });
        continue;
      }

      // Check daily limit
      const daily = this.dailyCounts.get(providerName)!;
      if (Date.now() >= daily.resetAt) {
        daily.count = 0;
        daily.resetAt = this.getNextDayReset();
      }
      if (daily.count >= provider.maxRpd) {
        errors.push({ provider: providerName, error: 'daily_limit' });
        continue;
      }

      try {
        rl.consume();
        daily.count++;

        const startTime = Date.now();
        const response = await this.callProvider(provider, apiKey, request);
        const latencyMs = Date.now() - startTime;

        cb.recordSuccess();

        return {
          ...response,
          provider: providerName,
          latencyMs,
        };
      } catch (error) {
        cb.recordFailure();
        errors.push({
          provider: providerName,
          error: error instanceof Error ? error.message : 'unknown',
        });
      }
    }

    throw new AIServiceError(
      'ALL_PROVIDERS_EXHAUSTED',
      `All AI providers failed for task ${task}`,
      errors
    );
  }

  /**
   * Call a specific provider's API.
   * Each provider has a slightly different API format.
   */
  private async callProvider(
    provider: AIProvider,
    _apiKey: string,
    request: AIRequest
  ): Promise<Omit<AIResponse, 'provider' | 'latencyMs'>> {
    // This is the adapter layer — in real implementation each provider
    // has its own API format. Using OpenAI-compatible format as base.
    
    // In development mode, return mock response
    if (this.config.environment === 'development') {
      return this.mockResponse(provider, request);
    }

    // Production implementation would call actual APIs here
    // Each provider adapter handles format differences:
    // - Gemini: Google AI SDK format
    // - Groq: OpenAI-compatible
    // - Nemotron: OpenAI-compatible
    // - Codestral: Mistral API format
    throw new Error(`Provider ${provider.name} not yet implemented for production`);
  }

  private mockResponse(
    provider: AIProvider,
    request: AIRequest
  ): Omit<AIResponse, 'provider' | 'latencyMs'> {
    const inputTokens = request.messages.reduce(
      (sum, m) => sum + Math.ceil(m.content.length / 4),
      0
    );
    return {
      content: JSON.stringify({
        status: 'mock_response',
        provider: provider.name,
        note: '⚠️ DEVELOPMENT MOCK — not a real AI response',
      }),
      model: provider.model,
      usage: {
        inputTokens,
        outputTokens: 100,
        totalTokens: inputTokens + 100,
      },
    };
  }

  private getNextDayReset(): number {
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
    tomorrow.setUTCHours(0, 0, 0, 0);
    return tomorrow.getTime();
  }
}

export class AIServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly providerErrors: Array<{ provider: string; error: string }>
  ) {
    super(message);
    this.name = 'AIServiceError';
  }
}
