import type { Socket } from 'socket.io-client';

import { createRealtimeSocket } from './realtime';

let socket: Socket | null = null;
let currentToken: string | null = null;

export const getRealtimeSocket = (token: string): Socket => {
  const nextToken = String(token || '').trim();
  if (!nextToken) {
    throw new Error('Missing realtime token');
  }

  if (socket && currentToken === nextToken) return socket;

  if (socket) {
    try {
      socket.disconnect();
    } catch {
      // ignore
    }
    socket = null;
  }

  currentToken = nextToken;
  socket = createRealtimeSocket(nextToken);
  return socket;
};

export const disconnectRealtimeSocket = () => {
  if (!socket) {
    currentToken = null;
    return;
  }

  try {
    socket.disconnect();
  } catch {
    // ignore
  } finally {
    socket = null;
    currentToken = null;
  }
};
