export interface VaultPolicy {
  modules: Record<string, { allow: string[] }>;
}

export interface SecretPolicyEngineOptions {
  /**
   * When `true`, secret access is denied if no policy is configured
   * (default-deny / strict mode). When `false` (default), access is permissive
   * with no configured policy, preserving backward-compatible behavior but
   * emitting a one-time warning on first access.
   */
  defaultDeny?: boolean;
}

export class SecretPolicyEngine {
  private policy: VaultPolicy = { modules: {} };
  private defaultDeny: boolean;
  private warnedNoPolicy = false;

  constructor(
    policyData?: VaultPolicy,
    options: SecretPolicyEngineOptions = {},
  ) {
    if (policyData) {
      this.policy = policyData;
    }
    this.defaultDeny = options.defaultDeny ?? false;
  }

  /**
   * Evaluates access permissions for a specific module name and secret key.
   */
  public isAllowed(moduleName: string, secretKey: string): boolean {
    // If no policies are registered, behavior depends on strict mode.
    if (Object.keys(this.policy.modules).length === 0) {
      if (this.defaultDeny) {
        return false;
      }
      // Backward-compatible permissive default, but warn once so operators know
      // secrets are being accessed with no access policy in place (CWE-1188).
      if (!this.warnedNoPolicy) {
        this.warnedNoPolicy = true;
        console.warn(
          '[Axiomify Vault] SECURITY: secret access is permissive because no ' +
            'ABAC policy is configured. Any module can read any secret. ' +
            'Configure `policy.modules` or enable strict mode (`defaultDeny`).',
        );
      }
      return true;
    }

    // Direct module matching or wildcard matching
    const rules = this.policy.modules[moduleName] ?? this.policy.modules['*'];
    if (!rules) {
      return false;
    }

    return rules.allow.includes(secretKey) || rules.allow.includes('*');
  }
}
