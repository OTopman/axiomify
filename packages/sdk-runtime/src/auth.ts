import { type ClientRequest } from './types';

export interface AuthProvider {
  /**
   * Called before every request to get the authorization header value
   * Example: return "Bearer eyJ..."
   */
  getToken(): Promise<string | null> | string | null;
}

export class StaticTokenProvider implements AuthProvider {
  constructor(private token: string) {}
  getToken(): string {
    return this.token;
  }
}

export class OAuth2BearerProvider implements AuthProvider {
  private currentToken: string | null = null;
  private expiresAt: number = 0;

  constructor(
    private tokenUrl: string,
    private clientId: string,
    private clientSecret: string,
    private scope?: string,
  ) {}

  async getToken(): Promise<string | null> {
    if (this.currentToken && Date.now() < this.expiresAt) {
      return `Bearer ${this.currentToken}`;
    }

    // Attempt to fetch new token
    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });
    if (this.scope) body.append('scope', this.scope);

    const res = await fetch(this.tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch OAuth2 token: ${res.status}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };
    this.currentToken = data.access_token;
    // Buffer expiration by 10 seconds
    this.expiresAt = Date.now() + (data.expires_in || 3600) * 1000 - 10000;

    return `Bearer ${this.currentToken}`;
  }
}
