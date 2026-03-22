import { io, Socket } from 'socket.io-client';

const API_URL = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:5000/api';
const SOCKET_URL = process.env.EXPO_PUBLIC_SOCKET_URL || API_URL.replace(/\/api$/, '');

export const createRealtimeSocket = (token: string): Socket => {
  const socket = io(SOCKET_URL, {
    auth: { token },
    path: '/socket.io',
    transports: ['websocket', 'polling'],
  });

  // Lightweight diagnostics (helps a lot on emulator/device networking issues).
  socket.on('connect', () => {
    console.log('[realtime] connected', { id: socket.id, url: SOCKET_URL });
  });
  socket.on('connect_error', (err: any) => {
    console.warn('[realtime] connect_error', { url: SOCKET_URL, message: String(err?.message || err) });
  });
  socket.on('disconnect', (reason: any) => {
    console.warn('[realtime] disconnected', { reason: String(reason) });
  });

  return socket;
};
