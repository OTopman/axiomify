export interface EnvironmentConfig {
  production: string;
  staging: string;
  development: string;
  [key: string]: string;
}

export class EnvironmentSwitcher {
  private currentEnv: string;

  constructor(private urls: EnvironmentConfig, defaultEnv: string = 'production') {
    this.currentEnv = defaultEnv;
  }

  setEnvironment(env: string): void {
    if (!this.urls[env]) {
      throw new Error(`Environment "${env}" is not configured.`);
    }
    this.currentEnv = env;
  }

  getCurrentEnvironment(): string {
    return this.currentEnv;
  }

  getUrl(): string {
    return this.urls[this.currentEnv];
  }
}
