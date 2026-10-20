import { configureStore } from '@reduxjs/toolkit';
import collectionsReducer from './slices/collectionsSlice';
import discoveryReducer from './slices/discoverySlice';
import environmentsReducer from './slices/environmentsSlice';
import requestTesterReducer from './slices/requestTesterSlice';
import uiReducer from './slices/uiSlice';
import websocketReducer from './slices/websocketSlice';

export const makeStore = () => {
  return configureStore({
    reducer: {
      ui: uiReducer,
      discovery: discoveryReducer,
      environments: environmentsReducer,
      collections: collectionsReducer,
      requestTester: requestTesterReducer,
      websocket: websocketReducer,
    },
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        serializableCheck: false, // Allows rich response payloads and event handlers
      }),
  });
};

export const store = makeStore();

export type AppStore = ReturnType<typeof makeStore>;
export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
