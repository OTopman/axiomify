import { createSlice, PayloadAction } from '@reduxjs/toolkit';
import {
  createStudioId,
  loadRequestCollections,
  saveRequestCollections,
  type RequestCollection,
  type SavedRequest,
} from '../../utils/request-collections';

export interface CollectionsState {
  collections: RequestCollection[];
  selectedCollectionId: string;
}

const getInitialCollections = (): RequestCollection[] => {
  return loadRequestCollections();
};

const initialCols = getInitialCollections();
const initialSelectedId = initialCols.length > 0 ? initialCols[0].id : '';

const initialState: CollectionsState = {
  collections: initialCols,
  selectedCollectionId: initialSelectedId,
};

export const collectionsSlice = createSlice({
  name: 'collections',
  initialState,
  reducers: {
    selectCollection: (state, action: PayloadAction<string>) => {
      state.selectedCollectionId = action.payload;
    },
    createCollection: (state, action: PayloadAction<string>) => {
      const name = action.payload.trim();
      if (!name) return;
      const newCol: RequestCollection = {
        id: createStudioId('collection'),
        name,
        requests: [],
      };
      state.collections.push(newCol);
      state.selectedCollectionId = newCol.id;
      saveRequestCollections(state.collections);
    },
    deleteCollection: (state, action: PayloadAction<string>) => {
      const id = action.payload;
      state.collections = state.collections.filter((col) => col.id !== id);
      if (state.selectedCollectionId === id) {
        state.selectedCollectionId =
          state.collections.length > 0 ? state.collections[0].id : '';
      }
      saveRequestCollections(state.collections);
    },
    saveRequestToCollection: (
      state,
      action: PayloadAction<{ collectionId: string; request: SavedRequest }>,
    ) => {
      const { collectionId, request } = action.payload;
      state.collections = state.collections.map((col) =>
        col.id === collectionId
          ? { ...col, requests: [...col.requests, request] }
          : col,
      );
      saveRequestCollections(state.collections);
    },
    deleteRequestFromCollection: (
      state,
      action: PayloadAction<{ collectionId: string; requestId: string }>,
    ) => {
      const { collectionId, requestId } = action.payload;
      state.collections = state.collections.map((col) =>
        col.id === collectionId
          ? {
              ...col,
              requests: col.requests.filter((r) => r.id !== requestId),
            }
          : col,
      );
      saveRequestCollections(state.collections);
    },
  },
});

export const {
  selectCollection,
  createCollection,
  deleteCollection,
  saveRequestToCollection,
  deleteRequestFromCollection,
} = collectionsSlice.actions;

export default collectionsSlice.reducer;
