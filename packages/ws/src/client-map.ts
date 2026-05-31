import type { WsClient } from '@axiomify/core';
import type { RoomClient } from './types';

export const wsClientMap = new WeakMap<RoomClient, WsClient<any>>();
