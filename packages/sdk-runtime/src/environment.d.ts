export interface EnvironmentConfig {
    production: string;
    staging: string;
    development: string;
    [key: string]: string;
}
export declare class EnvironmentSwitcher {
    private urls;
    private currentEnv;
    constructor(urls: EnvironmentConfig, defaultEnv?: string);
    setEnvironment(env: string): void;
    getCurrentEnvironment(): string;
    getUrl(): string;
}
//# sourceMappingURL=environment.d.ts.map