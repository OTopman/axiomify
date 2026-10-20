import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface WebSocketState {
  connected: boolean;
  buildError: string | null;
  reloadError: string | null;
  lastReloadTime: number | null;
  reconnectCount: number;
}

const initialState: WebSocketState = {
  connected: false,
  buildError: null,
  reloadError: null,
  lastReloadTime: null,
  reconnectCount: 0,
};

export const websocketSlice = createSlice({
  name: 'websocket',
  initialState,
  reducers: {
    setWsConnected: (state, action: PayloadAction<boolean>) => {
      state.connected = action.payload;
      if (action.payload) {
        state.buildError = null;
        state.reloadError = null;
      }
    },
    setBuildError: (state, action: PayloadAction<string | null>) => {
      state.buildError = action.payload;
    },
    setReloadError: (state, action: PayloadAction<string | null>) => {
      state.reloadError = action.payload;
    },
    recordReload: (state) => {
      state.lastReloadTime = Date.now();
      state.buildError = null;
      state.reloadError = null;
    },
    incrementReconnectCount: (state) => {
      state.reconnectCount += 1;
    },
  },
});

export const {
  setWsConnected,
  setBuildError,
  setReloadError,
  recordReload,
  incrementReconnectCount,
} = websocketSlice.actions;

export default websocketSlice.reducer;
