import { describe, expect, it } from 'vitest';
import reducer, {
  addVariable,
  createEnvironment,
  deleteEnvironment,
  mergeEnvironmentVariables,
  removeVariable,
  saveCurrentEnvironment,
  selectEnvironment,
  setEnvironmentVariables,
  updateVariable,
  type EnvironmentsState,
} from '../src/store/slices/environmentsSlice';

describe('environmentsSlice', () => {
  const getInitialState = (): EnvironmentsState => ({
    environments: [
      {
        id: 'env-1',
        name: 'Local',
        variables: [{ key: 'apiUrl', value: 'http://localhost:3000' }],
      },
      {
        id: 'env-2',
        name: 'Production',
        variables: [{ key: 'apiUrl', value: 'https://api.production.com' }],
      },
    ],
    selectedEnvironmentId: 'env-1',
    environmentVariables: [{ key: 'apiUrl', value: 'http://localhost:3000' }],
  });

  it('selects an environment and loads its variables', () => {
    let state = getInitialState();
    state = reducer(state, selectEnvironment('env-2'));
    expect(state.selectedEnvironmentId).toBe('env-2');
    expect(state.environmentVariables).toEqual([
      { key: 'apiUrl', value: 'https://api.production.com' },
    ]);
  });

  it('creates and selects a new environment', () => {
    let state = getInitialState();
    state = reducer(state, createEnvironment('Staging'));
    expect(state.environments).toHaveLength(3);
    expect(state.environments[2].name).toBe('Staging');
    expect(state.selectedEnvironmentId).toBe(state.environments[2].id);
    expect(state.environmentVariables).toEqual([]);

    // Blank name is ignored
    state = reducer(state, createEnvironment('   '));
    expect(state.environments).toHaveLength(3);
  });

  it('deletes an environment and falls back cleanly', () => {
    let state = getInitialState();
    state = reducer(state, deleteEnvironment('env-1'));
    expect(state.environments).toHaveLength(1);
    expect(state.selectedEnvironmentId).toBe('env-2');
    expect(state.environmentVariables).toEqual([
      { key: 'apiUrl', value: 'https://api.production.com' },
    ]);

    state = reducer(state, deleteEnvironment('env-2'));
    expect(state.environments).toHaveLength(0);
    expect(state.selectedEnvironmentId).toBe('');
    expect(state.environmentVariables).toEqual([]);
  });

  it('manages variable rows: set, add, update, remove', () => {
    let state = getInitialState();
    state = reducer(
      state,
      setEnvironmentVariables([{ key: 'k1', value: 'v1' }]),
    );
    expect(state.environmentVariables).toHaveLength(1);

    state = reducer(state, addVariable());
    expect(state.environmentVariables).toHaveLength(2);
    expect(state.environmentVariables[1]).toEqual({ key: '', value: '' });

    state = reducer(
      state,
      updateVariable({ index: 1, key: 'k2', value: 'v2' }),
    );
    expect(state.environmentVariables[1]).toEqual({ key: 'k2', value: 'v2' });

    state = reducer(state, updateVariable({ index: 1, key: 'newKey' }));
    expect(state.environmentVariables[1].key).toBe('newKey');

    state = reducer(state, updateVariable({ index: 1, value: 'newVal' }));
    expect(state.environmentVariables[1].value).toBe('newVal');

    state = reducer(state, removeVariable(0));
    expect(state.environmentVariables).toHaveLength(1);
    expect(state.environmentVariables[0].key).toBe('newKey');
  });

  it('saves current environment variables back to active environment', () => {
    let state = getInitialState();
    state = reducer(state, addVariable());
    state = reducer(
      state,
      updateVariable({ index: 1, key: 'token', value: 'secret' }),
    );
    state = reducer(state, saveCurrentEnvironment());

    const saved = state.environments.find((e) => e.id === 'env-1');
    expect(saved?.variables).toHaveLength(2);
    expect(saved?.variables[1]).toEqual({ key: 'token', value: 'secret' });
  });

  it('merges environment variables from post-response or pre-request scripts', () => {
    let state = getInitialState();

    // Updates existing variable and adds new ones
    state = reducer(
      state,
      mergeEnvironmentVariables({
        apiUrl: 'http://localhost:8080',
        authToken: 'jwt-12345',
      }),
    );

    expect(state.environmentVariables).toContainEqual({
      key: 'apiUrl',
      value: 'http://localhost:8080',
    });
    expect(state.environmentVariables).toContainEqual({
      key: 'authToken',
      value: 'jwt-12345',
    });

    const env1 = state.environments.find((e) => e.id === 'env-1');
    expect(env1?.variables).toContainEqual({
      key: 'authToken',
      value: 'jwt-12345',
    });

    // Unsets variable when value is empty string
    state = reducer(state, mergeEnvironmentVariables({ authToken: '' }));
    expect(
      state.environmentVariables.find((v) => v.key === 'authToken'),
    ).toBeUndefined();
  });

  it('merges environment variables into auto-created default when none exist', () => {
    const emptyState: EnvironmentsState = {
      environments: [],
      selectedEnvironmentId: '',
      environmentVariables: [],
    };

    const state = reducer(
      emptyState,
      mergeEnvironmentVariables({ extractedToken: 'xyz' }),
    );

    expect(state.environments).toHaveLength(1);
    expect(state.environments[0].name).toBe('Default');
    expect(state.selectedEnvironmentId).toBe(state.environments[0].id);
    expect(state.environmentVariables).toEqual([
      { key: 'extractedToken', value: 'xyz' },
    ]);
  });
});
