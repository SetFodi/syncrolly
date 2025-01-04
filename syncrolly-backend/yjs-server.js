const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils.js');
const { LeveldbPersistence } = require('y-leveldb');
const dotenv = require('dotenv');
const url = require('url');
const Y = require('yjs');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb'); // Add MongoDB client

dotenv.config();

// MongoDB setup
const MONGO_URI = process.env.MONGO_URI;
const mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
let roomsCollection;

// Define the port for the Yjs WebSocket server
const PORT = process.env.YJS_PORT || 1234;

// Define the persistence directory
const persistenceDir = path.join(__dirname, 'yjs-docs');
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

// Function to sync content to MongoDB
async function syncToMongo(roomName, ydoc) {
  try {
    if (!roomsCollection) return;
    
    const content = ydoc.getText('shared-text').toString();
    await roomsCollection.updateOne(
      { roomId: roomName },
      { 
        $set: { 
          text: content,
          lastActivity: new Date()
        }
      },
      { upsert: true }
    );
    console.log(`Synced document ${roomName} to MongoDB`);
  } catch (error) {
    console.error(`Error syncing to MongoDB for room ${roomName}:`, error);
  }
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
      // First try to get from MongoDB
      const mongoDoc = await roomsCollection?.findOne({ roomId: roomName });
      if (mongoDoc?.text) {
        ydoc.getText('shared-text').insert(0, mongoDoc.text);
        console.log(`Loaded document ${roomName} from MongoDB`);
      } else {
        // If not in MongoDB, try LevelDB
        const persistedDoc = await persistence.getYDoc(roomName);
        if (persistedDoc) {
          Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedDoc));
          console.log(`Loaded document ${roomName} from LevelDB`);
          // Sync to MongoDB immediately
          await syncToMongo(roomName, ydoc);
        }
      }
    } catch (err) {
      console.error(`Error loading document ${roomName}:`, err);
    }
    
    documents.set(roomName, ydoc);
  }

  // Set up persistence intervals
  const persistenceInterval = setInterval(async () => {
    try {
      if (documents.has(roomName)) {
        // Save to both LevelDB and MongoDB
        await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc));
        await syncToMongo(roomName, ydoc);
      } else {
        clearInterval(persistenceInterval);
      }
    } catch (error) {
      console.error(`Error in persistence interval for room ${roomName}:`, error);
    }
  }, PERSISTENCE_INTERVAL);

  // Handle disconnection
  conn.on('close', async () => {
    try {
      // Final save before cleanup
      if (documents.has(roomName)) {
        await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc));
        await syncToMongo(roomName, ydoc);
        console.log(`Final save completed for room ${roomName}`);
      }
    } catch (error) {
      console.error(`Error in final save for room ${roomName}:`, error);
    }
  });

  // Setup Yjs connection
  setupWSConnection(conn, req, {
    docName: roomName,
    gc: true,
    gcFilter: () => false, // Disable garbage collection
    persistence: persistence,
  });
});

// Start the server
async function startServer() {
  try {
    // Connect to MongoDB first
    await mongoClient.connect();
    console.log('Connected to MongoDB');
    const db = mongoClient.db('syncrolly');
    roomsCollection = db.collection('rooms');

    // Then start the server
    server.listen(PORT, () => {
      console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
