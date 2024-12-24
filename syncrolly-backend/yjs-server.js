// yjs-server.js

const http = require('http');
const WebSocket = require('ws');
const setupWSConnection = require('y-websocket/bin/utils.js').setupWSConnection;
const LeveldbPersistence = require('y-leveldb').LeveldbPersistence;
const dotenv = require('dotenv');
const { MongoClient } = require('mongodb');
const url = require('url');
const Y = require('yjs');

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
    roomName: roomName || 'Unnamed Room',
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

// Connect to MongoDB
const MONGO_URI = process.env.MONGO_URI;
const MONGO_DB = process.env.MONGO_DB || 'syncrolly';
let roomsCollection;

const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

client.connect()
  .then(() => {
    console.log('Connected to MongoDB from Yjs server');
    const db = client.db(MONGO_DB);
    roomsCollection = db.collection('rooms');

    // Start the WebSocket server after MongoDB connection is established
    server.listen(PORT, () => {
      console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
    });
  })
  .catch(err => {
    console.error('Failed to connect to MongoDB:', err);
    process.exit(1);
  });

// Handle WebSocket connections
wss.on('connection', (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0] || 'Unnamed Room';
  console.log(`Client connected to room: ${roomName}`);

  // Initialize room data if not present
  if (!roomData[roomName]) {
    roomData[roomName] = 0;
  }
  roomData[roomName]++;

  // Broadcast updated room data
  broadcastRoomData();

  // Keep connection alive with pings
  const keepAliveInterval = setInterval(() => {
    if (conn.readyState === WebSocket.OPEN) {
      conn.ping();
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 25000); // Ping every 25 seconds

  conn.on('pong', () => {
    console.log(`Pong received from client in room: ${roomName}`);
  });

  // Handle disconnection
  conn.on('close', () => {
    console.log(`Client disconnected from room: ${roomName}`);
    if (roomData[roomName]) {
      roomData[roomName]--;
      if (roomData[roomName] <= 0) {
        delete roomData[roomName];
      }
    }

    // Broadcast updated room data
    broadcastRoomData();
    clearInterval(keepAliveInterval);
  });

  // Setup Yjs WebSocket connection
  setupWSConnection(conn, req, {
    docName: roomName,
    persistence,
    gc: true, // garbage collect
  });

  // After setupWSConnection, get the Yjs document and attach an observer
  persistence.getYDoc(roomName).then((ydoc) => {
    ydoc.on('update', async (update, origin) => {
      if (roomsCollection) {
        try {
          await roomsCollection.updateOne(
            { roomId: roomName },
            { $set: { lastActivity: new Date() } },
            { upsert: true }
          );
          console.log(`Updated lastActivity for room: ${roomName}`);
        } catch (error) {
          console.error(`Error updating lastActivity for room ${roomName}:`, error);
        }
      }
    });
  }).catch(err => {
    console.error(`Error getting YDoc for room ${roomName}:`, err);
  });
});
