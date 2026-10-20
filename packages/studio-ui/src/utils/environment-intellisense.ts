export interface AvailableVariable {
  key: string;
  value: string;
  environmentName?: string;
  environmentId?: string;
  isCurrentEnv?: boolean;
}

export interface VariableTokenContext {
  isOpen: boolean;
  query: string;
  tokenStart: number;
  tokenEnd: number;
  hasClosingBraces: boolean;
}

/**
 * Checks if the cursor is currently inside or immediately after an unclosed `{{` reference.
 */
export function extractVariableReferenceContext(
  text: string,
  cursorPosition: number,
): VariableTokenContext | null {
  if (cursorPosition < 0 || cursorPosition > text.length) return null;
  const beforeCursor = text.slice(0, cursorPosition);
  const lastOpen = beforeCursor.lastIndexOf('{{');
  if (lastOpen === -1) return null;

  // Check if there is an intervening closing '}}' between '{{' and cursor
  const closingBetween = beforeCursor.indexOf('}}', lastOpen);
  if (closingBetween !== -1) return null;

  const rawQuery = beforeCursor.slice(lastOpen + 2);
  // Do not trigger if there are newlines or nested braces
  if (/[\r\n{}]/.test(rawQuery)) return null;

  const afterCursor = text.slice(cursorPosition);
  const hasClosingBraces = afterCursor.startsWith('}}');

  return {
    isOpen: true,
    query: rawQuery.trim(),
    tokenStart: lastOpen,
    tokenEnd: cursorPosition,
    hasClosingBraces,
  };
}

/**
 * Filters available variables matching the query string by key, value, or environment name.
 */
export function filterVariables(
  variables: AvailableVariable[],
  query: string,
): AvailableVariable[] {
  const cleanQuery = query.trim().toLowerCase();
  if (!cleanQuery) return variables;
  return variables.filter(
    (v) =>
      v.key.toLowerCase().includes(cleanQuery) ||
      v.value.toLowerCase().includes(cleanQuery) ||
      (v.environmentName &&
        v.environmentName.toLowerCase().includes(cleanQuery)),
  );
}

/**
 * Replaces the partial `{{query` token with `{{variableKey}}` and returns the new text and cursor position.
 */
export function insertVariableAtCursor(
  text: string,
  tokenStart: number,
  tokenEnd: number,
  variableKey: string,
): { newText: string; newCursor: number } {
  const beforeToken = text.slice(0, tokenStart);
  let afterToken = text.slice(tokenEnd);

  // If text immediately following starts with closing braces, strip them to avoid duplicates
  if (afterToken.startsWith('}}')) {
    afterToken = afterToken.slice(2);
  } else if (afterToken.startsWith('}')) {
    afterToken = afterToken.slice(1);
  }

  const inserted = `{{${variableKey}}}`;
  const newText = beforeToken + inserted + afterToken;
  const newCursor = beforeToken.length + inserted.length;

  return { newText, newCursor };
}

/**
 * Aggregates all environment variables for IntelliSense, prioritising the active environment.
 */
export function collectAvailableVariables(
  environments: Array<{
    id: string;
    name: string;
    variables: Array<{ key: string; value: string }>;
  }>,
  selectedEnvironmentId?: string,
  serverEnv?: Record<string, string>,
): AvailableVariable[] {
  const list: AvailableVariable[] = [];
  const seenKeys = new Set<string>();

  // 1. Current active environment
  const currentEnv = environments.find((e) => e.id === selectedEnvironmentId);
  if (currentEnv) {
    for (const v of currentEnv.variables) {
      const key = v.key.trim();
      if (key) {
        list.push({
          key,
          value: v.value,
          environmentName: currentEnv.name,
          environmentId: currentEnv.id,
          isCurrentEnv: true,
        });
        seenKeys.add(key);
      }
    }
  }

  // 2. Other environments
  for (const env of environments) {
    if (env.id === selectedEnvironmentId) continue;
    for (const v of env.variables) {
      const key = v.key.trim();
      if (key && !seenKeys.has(key)) {
        list.push({
          key,
          value: v.value,
          environmentName: env.name,
          environmentId: env.id,
          isCurrentEnv: false,
        });
        seenKeys.add(key);
      }
    }
  }

  // 3. Server environment variables
  if (serverEnv && typeof serverEnv === 'object') {
    for (const [key, value] of Object.entries(serverEnv)) {
      const cleanKey = key.trim();
      if (cleanKey && !seenKeys.has(cleanKey)) {
        list.push({
          key: cleanKey,
          value: String(value),
          environmentName: 'Server Env',
          isCurrentEnv: false,
        });
        seenKeys.add(cleanKey);
      }
    }
  }

  return list;
}
