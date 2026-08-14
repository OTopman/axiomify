export interface RequestKeyValue {
  key: string;
  value: string;
}

export interface SavedRequest {
  id: string;
  name: string;
  method: string;
  path: string;
  queryParams: RequestKeyValue[];
  pathParams: RequestKeyValue[];
  headers: RequestKeyValue[];
  bodyMode: 'none' | 'json' | 'text' | 'form-data' | 'urlencoded';
  body: string;
  bodyFields: RequestKeyValue[];
}

export interface RequestCollection {
  id: string;
  name: string;
  requests: SavedRequest[];
}

export interface RequestEnvironment {
  id: string;
  name: string;
  variables: RequestKeyValue[];
}

const COLLECTIONS_KEY = 'axiomify_studio_request_collections';
const ENVIRONMENTS_KEY = 'axiomify_studio_request_environments';

function storage(): Storage | null {
  return typeof window === 'undefined' ? null : window.localStorage;
}

function readList<T>(key: string): T[] {
  try {
    const value = storage()?.getItem(key);
    const parsed = value ? JSON.parse(value) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeList<T>(key: string, value: T[]): void {
  storage()?.setItem(key, JSON.stringify(value));
}

export function loadRequestCollections(): RequestCollection[] {
  return readList<RequestCollection>(COLLECTIONS_KEY);
}

export function saveRequestCollections(collections: RequestCollection[]): void {
  writeList(COLLECTIONS_KEY, collections);
}

export function loadRequestEnvironments(): RequestEnvironment[] {
  return readList<RequestEnvironment>(ENVIRONMENTS_KEY);
}

export function saveRequestEnvironments(
  environments: RequestEnvironment[],
): void {
  writeList(ENVIRONMENTS_KEY, environments);
}

export function createStudioId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Replaces {{variable}} tokens. Unknown variables remain visible and unchanged. */
export function substituteRequestVariables(
  value: string,
  variables: RequestKeyValue[],
): string {
  const values = new Map(
    variables
      .filter((variable) => variable.key.trim())
      .map((variable) => [variable.key.trim(), variable.value]),
  );
  return value.replace(/{{\s*([^{}\s]+)\s*}}/g, (token, key) =>
    values.has(key) ? values.get(key)! : token,
  );
}
