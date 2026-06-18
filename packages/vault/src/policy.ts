export interface VaultPolicy {
  modules: Record<string, { allow: string[] }>;
}

export class SecretPolicyEngine {
  private policy: VaultPolicy = { modules: {} };

  constructor(policyData?: VaultPolicy) {
    if (policyData) {
      this.policy = policyData;
    }
  }

  /**
   * Evaluates access permissions for a specific module name and secret key.
   */
  public isAllowed(moduleName: string, secretKey: string): boolean {
    // If no policies are registered, default to permissive for backward compatibility
    if (Object.keys(this.policy.modules).length === 0) {
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
