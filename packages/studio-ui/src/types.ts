export interface RouteItem {
  method: string;
  path: string;
  isWs?: boolean;
  realtimeProtocol?: string;
  deprecated?: boolean;
  operationId?: string;
  tags?: string[];
  plugins?: string[];
  validation: string[];
}

export interface SchemaSection {
  type?: string;
  properties?: Record<string, any>;
  required?: string[];
  [key: string]: any;
}

export interface SchemaItem {
  method: string;
  path: string;
  body?: SchemaSection;
  query?: SchemaSection;
  params?: SchemaSection;
  response?: SchemaSection;
  message?: SchemaSection;
  files?: SchemaSection;
}

export interface HookItem {
  type: string;
  name?: string;
  count: number;
  handlers: string[];
}

export interface ServiceItem {
  token: string;
  type: string;
  methods: string[];
}

export interface FindingItem {
  id: string;
  title: string;
  description: string;
  remediation: string;
  severity: 'ok' | 'warn' | 'fail';
  area: string;
  cwe?: string;
}

export interface DiscoveredHealthFinding {
  severity: 'ok' | 'warn' | 'fail';
  area: string;
  message: string;
  hint?: string;
}

export interface HealthData {
  summary: {
    failures: number;
    warnings: number;
    passes: number;
  };
  findings: DiscoveredHealthFinding[];
}

export interface ArchNode {
  id: string;
  name?: string;
  label?: string;
  type:
    | 'route'
    | 'middleware'
    | 'validation'
    | 'controller'
    | 'service'
    | 'repository'
    | 'database'
    | string;
  dependencies?: string[];
}

export interface DiscoveryData {
  routes: RouteItem[];
  schemas: SchemaItem[];
  openapi?: any;
  drift?: {
    hasFile: boolean;
    synced: boolean;
    diffs: string[];
  };
  config: {
    httpRouteCount: number;
    wsRouteCount: number;
    hookCount: number;
    [key: string]: any;
  };
  hooks: HookItem[];
  services?: ServiceItem[];
  health?: HealthData;
  archMap?: ArchNode[];
  [key: string]: any;
}

export interface WsLogItem {
  type: 'sent' | 'received' | 'info' | 'error';
  time: string;
  event?: string | null;
  payload: string;
}

export interface AssertionRule {
  id: string;
  type: 'equals' | 'contains' | 'regex';
  target: 'event' | 'payload';
  value: string;
}

export interface AssertionResult {
  rule: AssertionRule;
  passed: boolean;
  actual: string;
}
