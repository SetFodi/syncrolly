// yjs-server.js

const http = require('http');
const WebSocket = require('ws');
const setupWSConnection = require('y-websocket/bin/utils.js').setupWSConnection;
const LeveldbPersistence = require('y-leveldb').LeveldbPersistence;
const dotenv = require('dotenv');
dotenv.config();

// Define the port for the Yjs WebSocket server
const PORT = process.env.YJS_PORT || 1234;

// Initialize LevelDB persistence
const persistence = new LeveldbPersistence('./yjs-data');

// Create an HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Yjs WebSocket Server');
});

// Initialize the WebSocket server instance
const wss = new WebSocket.Server({ server });

// Handle WebSocket connections
wss.on('connection', (conn, req) => {
  const url = req.url;
  const roomName = url.slice(1).split('?')[0]; // Extract room name from URL
  console.log(`Client connected to room: ${roomName}`);

  setupWSConnection(conn, req, {
    docName: roomName,
    persistence,
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
});
