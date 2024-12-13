// frontend/src/socket.js

import { io } from 'socket.io-client';

const backendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:4000';

const socket = io(backendUrl, {
  transports: ['websocket'], // Optional: Use WebSocket only
});

export default socket;
