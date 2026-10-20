import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  createStudioId,
  loadRequestEnvironments,
  saveRequestEnvironments,
  type RequestEnvironment,
  type RequestKeyValue,
} from '../../utils/request-collections';

export interface EnvironmentsState {
  environments: RequestEnvironment[];
  selectedEnvironmentId: string;
  environmentVariables: RequestKeyValue[];
}

const getInitialEnvironments = (): RequestEnvironment[] => {
  return loadRequestEnvironments();
};

const initialEnvs = getInitialEnvironments();
const initialSelectedId = initialEnvs.length > 0 ? initialEnvs[0].id : '';
const initialVariables =
  initialEnvs.length > 0 ? initialEnvs[0].variables || [] : [];

const initialState: EnvironmentsState = {
  environments: initialEnvs,
  selectedEnvironmentId: initialSelectedId,
  environmentVariables: initialVariables,
};

export const environmentsSlice = createSlice({
  name: 'environments',
  initialState,
  reducers: {
    selectEnvironment: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      state.selectedEnvironmentId = id;
      const found = state.environments.find((env) => env.id === id);
      state.environmentVariables = found?.variables ? [...found.variables] : [];
    },
    createEnvironment: (state, action: PayloadAction<string>) => {
      const name = action.payload.trim();
      if (!name) return;
      const newEnv: RequestEnvironment = {
        id: createStudioId('environment'),
        name,
        variables: [],
      };
      state.environments.push(newEnv);
      state.selectedEnvironmentId = newEnv.id;
      state.environmentVariables = [];
      saveRequestEnvironments(state.environments);
    },
    deleteEnvironment: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      state.environments = state.environments.filter((env) => env.id !== id);
      if (state.selectedEnvironmentId === id) {
        if (state.environments.length > 0) {
          state.selectedEnvironmentId = state.environments[0].id;
          state.environmentVariables = [
            ...(state.environments[0].variables || []),
          ];
        } else {
          state.selectedEnvironmentId = '';
          state.environmentVariables = [];
        }
      }
      saveRequestEnvironments(state.environments);
    },
    setEnvironmentVariables: (
      state,
      action: PayloadAction<RequestKeyValue[]>,
    ) => {
      state.environmentVariables = action.payload;
    },
    addVariable: (state) => {
      state.environmentVariables.push({ key: '', value: '' });
    },
    updateVariable: (
      state,
      action: PayloadAction<{ index: number; key?: string; value?: string }>,
    ) => {
      const { index, key, value } = action.payload;
      if (state.environmentVariables[index]) {
        if (key !== undefined) state.environmentVariables[index].key = key;
        if (value !== undefined) state.environmentVariables[index].value = value;
      }
    },
    removeVariable: (state, action: PayloadAction<number>) => {
      state.environmentVariables.splice(action.payload, 1);
    },
    saveCurrentEnvironment: (state) => {
      if (!state.selectedEnvironmentId) return;
      const cleaned = state.environmentVariables.filter((v) => v.key.trim());
      state.environments = state.environments.map((env) =>
        env.id === state.selectedEnvironmentId
          ? { ...env, variables: cleaned }
          : env,
      );
      saveRequestEnvironments(state.environments);
    },
  },
});

export const {
  selectEnvironment,
  createEnvironment,
  deleteEnvironment,
  setEnvironmentVariables,
  addVariable,
  updateVariable,
  removeVariable,
  saveCurrentEnvironment,
} = environmentsSlice.actions;

export default environmentsSlice.reducer;
