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

// Object to track active rooms and their client counts
const roomData = {};

// Function to broadcast room data to all connected clients
function broadcastRoomData() {
  const activeRooms = Object.entries(roomData).map(([roomName, clients]) => ({
    roomName,
    clients,
  }));
  const message = JSON.stringify({ type: 'room_data', data: activeRooms });

  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(message);
    }
  });

  console.log('Active Rooms:', activeRooms);
}

// Handle WebSocket connections
wss.on('connection', (conn, req) => {
  const url = req.url;
  const roomName = url.slice(1).split('?')[0]; // Extract room name from URL
  console.log(`Client connected to room: ${roomName}`);

  // Initialize room data if not present
  if (!roomData[roomName]) {
    roomData[roomName] = 0;
  }
  roomData[roomName]++;

  // Broadcast updated room data
  broadcastRoomData();

  // Handle disconnection
  conn.on('close', () => {
    console.log(`Client disconnected from room: ${roomName}`);
    if (roomData[roomName]) {
      roomData[roomName]--;
      if (roomData[roomName] <= 0) {
        delete roomData[roomName]; // Remove empty rooms
      }
    }

    // Broadcast updated room data
    broadcastRoomData();
  });

  // Setup Yjs WebSocket connection
  setupWSConnection(conn, req, {
    docName: roomName,
    persistence,
  });
});

// Start the server
server.listen(PORT, () => {
  console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
});
