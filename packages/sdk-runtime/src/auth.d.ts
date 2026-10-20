export interface AuthProvider {
  /**
   * Called before every request to get the authorization header value
   * Example: return "Bearer eyJ..."
   */
  getToken(): Promise<string | null> | string | null;
}
export declare class StaticTokenProvider implements AuthProvider {
  private token;
  constructor(token: string);
  getToken(): string;
}
export declare class OAuth2BearerProvider implements AuthProvider {
  private tokenUrl;
  private clientId;
  private clientSecret;
  private scope?;
  private currentToken;
  private expiresAt;
  constructor(
    tokenUrl: string,
    clientId: string,
    clientSecret: string,
    scope?: string | undefined,
  );
  getToken(): Promise<string | null>;
}
//# sourceMappingURL=auth.d.ts.map
