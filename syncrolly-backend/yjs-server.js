// yjs-server.js

const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils.js');
const { LeveldbPersistence } = require('y-leveldb');
const dotenv = require('dotenv');
const url = require('url');
const Y = require('yjs');
const path = require('path');
const fs = require('fs');

dotenv.config();

// Define the port for the Yjs WebSocket server
const PORT = process.env.YJS_PORT || 1234;

// Define the persistence directory
const persistenceDir = path.join(__dirname, 'yjs-docs');
// Create the directory if it doesn't exist
if (!fs.existsSync(persistenceDir)) {
  fs.mkdirSync(persistenceDir);
}

// Initialize LevelDB Persistence
const persistence = new LeveldbPersistence(persistenceDir);
const PERSISTENCE_INTERVAL = 5000;
const documents = new Map();

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

// Handle WebSocket connections
wss.on('connection', async (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0];

  let ydoc;
  if (documents.has(roomName)) {
    ydoc = documents.get(roomName);
  } else {
    ydoc = new Y.Doc();
    
    try {
      const persistedDoc = await persistence.getYDoc(roomName);
      if (persistedDoc) {
        Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedDoc));
      }
    } catch (err) {
      console.error(`Error loading document ${roomName}:`, err);
    }
    
    documents.set(roomName, ydoc);
  }

  // Initialize room data if not present
  if (!roomData[roomName]) {
    roomData[roomName] = 0;
  }
  roomData[roomName]++;
  broadcastRoomData();

  // Keep connection alive with pings
  const keepAliveInterval = setInterval(() => {
    if (conn.readyState === WebSocket.OPEN) {
      conn.ping();
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 25000);

  const persistenceInterval = setInterval(async () => {
      try {
        if (documents.has(roomName)) {
          await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc));
          console.log(`Auto-saved document ${roomName}`);
        } else {
          clearInterval(persistenceInterval);
        }
      } catch (error) {
        console.error(`Error auto-saving document ${roomName}:`, error);
      }
    }, PERSISTENCE_INTERVAL);
  }

        conn.on('error', (error) => {
    console.error(`WebSocket error in room ${roomName}:`, error);
  });
  // Handle pong responses
  conn.on('pong', () => {
    console.log(`Pong received from client in room: ${roomName}`);
  });

  // Handle disconnection
  conn.on('close', async () => {
    console.log(`Client disconnected from room: ${roomName}`);
    if (roomData[roomName]) {
      roomData[roomName]--;
      if (roomData[roomName] <= 0) {
        try {
          // Final save before cleanup
          await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc));
          console.log(`Final save completed for room ${roomName}`);
          
          // Cleanup
          documents.delete(roomName);
          delete roomData[roomName];
        } catch (error) {
          console.error(`Error in final save for room ${roomName}:`, error);
        }
      }
    }
    clearInterval(keepAliveInterval);
    broadcastRoomData();
  });

  // Setup Yjs connection with enhanced options
  setupWSConnection(conn, req, {
    docName: roomName,
    gc: true,
    gcFilter: () => false, // Disable garbage collection for better persistence
    persistence: persistence,
  });
});

// Start the Yjs WebSocket server
server.listen(PORT, () => {
  console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
});
