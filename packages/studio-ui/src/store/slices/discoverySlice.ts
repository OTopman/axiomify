import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import { DiscoveryData } from '../../types';

export interface DiscoveryState {
  data: DiscoveryData | null;
  loading: boolean;
  error: string | null;
  lastUpdated: string | null;
}

const initialState: DiscoveryState = {
  data: null,
  loading: false,
  error: null,
  lastUpdated: null,
};

export const discoverySlice = createSlice({
  name: 'discovery',
  initialState,
  reducers: {
    setDiscoveryLoading: (state, action: PayloadAction<boolean>) => {
      state.loading = action.payload;
    },
    setDiscoveryData: (state, action: PayloadAction<DiscoveryData>) => {
      state.data = action.payload;
      state.loading = false;
      state.error = null;
      state.lastUpdated = new Date().toISOString();
    },
    setDiscoveryError: (state, action: PayloadAction<string>) => {
      state.error = action.payload;
      state.loading = false;
    },
  },
});

export const { setDiscoveryLoading, setDiscoveryData, setDiscoveryError } =
  discoverySlice.actions;

export default discoverySlice.reducer;
