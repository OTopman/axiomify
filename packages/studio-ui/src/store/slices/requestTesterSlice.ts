import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface KeyVal {
  key: string;
  value: string;
}

export interface UploadFile {
  field: string;
  name: string;
  type: string;
  contentBase64: string;
}

export type BodyMode = 'none' | 'json' | 'text' | 'form-data' | 'urlencoded';
export type SubTab =
  | 'params'
  | 'headers'
  | 'body'
  | 'uploads'
  | 'auth'
  | 'code'
  | 'replays'
  | 'env'
  | 'collections';
export type ResponseSubTab = 'body' | 'headers' | 'timeline' | 'queries';
export type AuthType = 'none' | 'bearer' | 'basic' | 'apiKey';

export interface ReplayItem {
  id: string;
  method: string;
  path: string;
  timestamp: string;
  status?: number;
  duration?: number;
  request?: any;
}

export interface RequestTesterState {
  method: string;
  path: string;
  queryParams: KeyVal[];
  pathParams: KeyVal[];
  headers: KeyVal[];
  bodyMode: BodyMode;
  reqBody: string;
  bodyFields: KeyVal[];
  uploads: UploadFile[];
  sending: boolean;
  response: any | null;
  replays: ReplayItem[];
  expandedTimelineItem: number | null;
  activeSubTab: SubTab;
  responseSubTab: ResponseSubTab;
  authType: AuthType;
  authToken: string;
  authUsername: string;
  authPassword: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyLocation: 'header' | 'query';
}

const initialState: RequestTesterState = {
  method: 'GET',
  path: '',
  queryParams: [],
  pathParams: [],
  headers: [{ key: 'Content-Type', value: 'application/json' }],
  bodyMode: 'json',
  reqBody: '',
  bodyFields: [],
  uploads: [],
  sending: false,
  response: null,
  replays: [],
  expandedTimelineItem: null,
  activeSubTab: 'params',
  responseSubTab: 'body',
  authType: 'none',
  authToken: '',
  authUsername: '',
  authPassword: '',
  apiKeyName: 'X-API-Key',
  apiKeyValue: '',
  apiKeyLocation: 'header',
};

export const requestTesterSlice = createSlice({
  name: 'requestTester',
  initialState,
  reducers: {
    setMethod: (state, action: PayloadAction<string>) => {
      state.method = action.payload;
    },
    setPath: (state, action: PayloadAction<string>) => {
      state.path = action.payload;
    },
    setQueryParams: (state, action: PayloadAction<KeyVal[]>) => {
      state.queryParams = action.payload;
    },
    addQueryParam: (state) => {
      state.queryParams.push({ key: '', value: '' });
    },
    updateQueryParam: (
      state,
      action: PayloadAction<{ index: number; key?: string; value?: string }>,
    ) => {
      const { index, key, value } = action.payload;
      if (state.queryParams[index]) {
        if (key !== undefined) state.queryParams[index].key = key;
        if (value !== undefined) state.queryParams[index].value = value;
      }
    },
    removeQueryParam: (state, action: PayloadAction<number>) => {
      state.queryParams.splice(action.payload, 1);
    },
    setPathParams: (state, action: PayloadAction<KeyVal[]>) => {
      state.pathParams = action.payload;
    },
    updatePathParam: (
      state,
      action: PayloadAction<{ index: number; key?: string; value?: string }>,
    ) => {
      const { index, key, value } = action.payload;
      if (state.pathParams[index]) {
        if (key !== undefined) state.pathParams[index].key = key;
        if (value !== undefined) state.pathParams[index].value = value;
      }
    },
    setHeaders: (state, action: PayloadAction<KeyVal[]>) => {
      state.headers = action.payload;
    },
    addHeader: (state) => {
      state.headers.push({ key: '', value: '' });
    },
    updateHeader: (
      state,
      action: PayloadAction<{ index: number; key?: string; value?: string }>,
    ) => {
      const { index, key, value } = action.payload;
      if (state.headers[index]) {
        if (key !== undefined) state.headers[index].key = key;
        if (value !== undefined) state.headers[index].value = value;
      }
    },
    removeHeader: (state, action: PayloadAction<number>) => {
      state.headers.splice(action.payload, 1);
    },
    setBodyMode: (state, action: PayloadAction<BodyMode>) => {
      state.bodyMode = action.payload;
    },
    setReqBody: (state, action: PayloadAction<string>) => {
      state.reqBody = action.payload;
    },
    setBodyFields: (state, action: PayloadAction<KeyVal[]>) => {
      state.bodyFields = action.payload;
    },
    addBodyField: (state) => {
      state.bodyFields.push({ key: '', value: '' });
    },
    updateBodyField: (
      state,
      action: PayloadAction<{ index: number; key?: string; value?: string }>,
    ) => {
      const { index, key, value } = action.payload;
      if (state.bodyFields[index]) {
        if (key !== undefined) state.bodyFields[index].key = key;
        if (value !== undefined) state.bodyFields[index].value = value;
      }
    },
    removeBodyField: (state, action: PayloadAction<number>) => {
      state.bodyFields.splice(action.payload, 1);
    },
    setUploads: (state, action: PayloadAction<UploadFile[]>) => {
      state.uploads = action.payload;
    },
    addUpload: (state, action: PayloadAction<UploadFile>) => {
      state.uploads.push(action.payload);
    },
    removeUpload: (state, action: PayloadAction<number>) => {
      state.uploads.splice(action.payload, 1);
    },
    setSending: (state, action: PayloadAction<boolean>) => {
      state.sending = action.payload;
    },
    setResponse: (state, action: PayloadAction<any | null>) => {
      state.response = action.payload;
    },
    setReplays: (state, action: PayloadAction<ReplayItem[]>) => {
      state.replays = action.payload;
    },
    setExpandedTimelineItem: (state, action: PayloadAction<number | null>) => {
      state.expandedTimelineItem = action.payload;
    },
    setActiveSubTab: (state, action: PayloadAction<SubTab>) => {
      state.activeSubTab = action.payload;
    },
    setResponseSubTab: (state, action: PayloadAction<ResponseSubTab>) => {
      state.responseSubTab = action.payload;
    },
    setAuthType: (state, action: PayloadAction<AuthType>) => {
      state.authType = action.payload;
    },
    setAuthToken: (state, action: PayloadAction<string>) => {
      state.authToken = action.payload;
    },
    setAuthUsername: (state, action: PayloadAction<string>) => {
      state.authUsername = action.payload;
    },
    setAuthPassword: (state, action: PayloadAction<string>) => {
      state.authPassword = action.payload;
    },
    setApiKeyName: (state, action: PayloadAction<string>) => {
      state.apiKeyName = action.payload;
    },
    setApiKeyValue: (state, action: PayloadAction<string>) => {
      state.apiKeyValue = action.payload;
    },
    setApiKeyLocation: (state, action: PayloadAction<'header' | 'query'>) => {
      state.apiKeyLocation = action.payload;
    },
    loadSavedRequest: (
      state,
      action: PayloadAction<{
        method: string;
        path: string;
        queryParams?: KeyVal[];
        pathParams?: KeyVal[];
        headers?: KeyVal[];
        bodyMode?: BodyMode;
        body?: string;
        bodyFields?: KeyVal[];
      }>,
    ) => {
      const p = action.payload;
      state.method = p.method;
      state.path = p.path;
      if (p.queryParams) state.queryParams = p.queryParams;
      if (p.pathParams) state.pathParams = p.pathParams;
      if (p.headers) state.headers = p.headers;
      if (p.bodyMode) state.bodyMode = p.bodyMode;
      if (p.body !== undefined) state.reqBody = p.body;
      if (p.bodyFields) state.bodyFields = p.bodyFields;
    },
  },
});

export const {
  setMethod,
  setPath,
  setQueryParams,
  addQueryParam,
  updateQueryParam,
  removeQueryParam,
  setPathParams,
  updatePathParam,
  setHeaders,
  addHeader,
  updateHeader,
  removeHeader,
  setBodyMode,
  setReqBody,
  setBodyFields,
  addBodyField,
  updateBodyField,
  removeBodyField,
  setUploads,
  addUpload,
  removeUpload,
  setSending,
  setResponse,
  setReplays,
  setExpandedTimelineItem,
  setActiveSubTab,
  setResponseSubTab,
  setAuthType,
  setAuthToken,
  setAuthUsername,
  setAuthPassword,
  setApiKeyName,
  setApiKeyValue,
  setApiKeyLocation,
  loadSavedRequest,
} = requestTesterSlice.actions;

export default requestTesterSlice.reducer;
