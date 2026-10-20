import { createSlice, PayloadAction } from '@reduxjs/toolkit';

export interface UIState {
  activeTab: string;
  isDark: boolean;
  commandPaletteOpen: boolean;
  routeModalOpen: boolean;
  sidebarCollapsed: boolean;
}

const initialState: UIState = {
  activeTab: 'tester', // Default to Request Tester
  isDark: true,
  commandPaletteOpen: false,
  routeModalOpen: false,
  sidebarCollapsed: false,
};

export const uiSlice = createSlice({
  name: 'ui',
  initialState,
  reducers: {
    setActiveTab: (state, action: PayloadAction<string>) => {
      state.activeTab = action.payload;
    },
    toggleTheme: (state) => {
      state.isDark = !state.isDark;
    },
    setTheme: (state, action: PayloadAction<boolean>) => {
      state.isDark = action.payload;
    },
    setCommandPaletteOpen: (state, action: PayloadAction<boolean>) => {
      state.commandPaletteOpen = action.payload;
    },
    setRouteModalOpen: (state, action: PayloadAction<boolean>) => {
      state.routeModalOpen = action.payload;
    },
    setSidebarCollapsed: (state, action: PayloadAction<boolean>) => {
      state.sidebarCollapsed = action.payload;
    },
    toggleSidebar: (state) => {
      state.sidebarCollapsed = !state.sidebarCollapsed;
    },
  },
});

export const {
  setActiveTab,
  toggleTheme,
  setTheme,
  setCommandPaletteOpen,
  setRouteModalOpen,
  setSidebarCollapsed,
  toggleSidebar,
} = uiSlice.actions;

export default uiSlice.reducer;
