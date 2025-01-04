const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils.js');
const { LeveldbPersistence } = require('y-leveldb');
const dotenv = require('dotenv');
const url = require('url');
const Y = require('yjs');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb'); // MongoDB client

dotenv.config();

// =========================
// ===== MongoDB Setup =====
// =========================
const MONGO_URI = process.env.MONGO_URI;
const mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

let roomsCollection;

// ===========================
// ===== Server Port Setup ====
// ===========================
const PORT = process.env.YJS_PORT || 1234;

// ================================
// ===== LevelDB Persistence ======
// ================================
const persistenceDir = path.join(__dirname, 'yjs-docs');
if (!fs.existsSync(persistenceDir)) {
  fs.mkdirSync(persistenceDir);
}

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

/**
 * Syncs the current Yjs document content to MongoDB.
 * @param {string} roomName
 * @param {Y.Doc} ydoc
 */
async function syncToMongo(roomName, ydoc) {
  try {
    if (!roomsCollection) return;

    const content = ydoc.getText('shared-text').toString();
    console.log(`syncToMongo: roomName=${roomName}, content="${content.slice(0, 50)}"`);

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

/**
 * Handles new WebSocket connections for Yjs collaboration.
 */
wss.on('connection', async (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0];

  let ydoc;
  if (documents.has(roomName)) {
    // Reuse existing doc
    ydoc = documents.get(roomName);
  } else {
    // Create a new Yjs doc
    ydoc = new Y.Doc();

    try {
      // Try to load from MongoDB first
      const mongoDoc = await roomsCollection.findOne({ roomId: roomName });
      if (mongoDoc && mongoDoc.text) {
        ydoc.getText('shared-text').insert(0, mongoDoc.text);
        console.log(`Loaded document ${roomName} from MongoDB`);
      } else {
        // If not in MongoDB, try LevelDB
        const persistedDoc = await persistence.getYDoc(roomName);
        if (persistedDoc) {
          Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedDoc));
          console.log(`Loaded document ${roomName} from LevelDB`);
          // Immediately sync to MongoDB
          await syncToMongo(roomName, ydoc);
        }
      }
    } catch (err) {
      console.error(`Error loading document ${roomName}:`, err);
    }

    documents.set(roomName, ydoc);
  }

  // Set up a persistence interval to regularly store updates
  const persistenceInterval = setInterval(async () => {
    try {
      if (documents.has(roomName)) {
        // Save updates in LevelDB
        await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc));
        // Also sync to MongoDB
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
      if (documents.has(roomName)) {
        // Final save
        await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc));
        await syncToMongo(roomName, ydoc);
        console.log(`Final save completed for room ${roomName}`);
      }
    } catch (error) {
      console.error(`Error in final save for room ${roomName}:`, error);
    }
  });

  // Set up the Yjs WebSocket connection
  setupWSConnection(conn, req, {
    docName: roomName,
    gc: true,
    gcFilter: () => false, // Disable garbage collection
    persistence: persistence
  });
});

/**
 * Starts the Yjs WebSocket server.
 */
async function startServer() {
  try {
    // Connect to MongoDB first
    await mongoClient.connect();
    console.log('Connected to MongoDB');

    const db = mongoClient.db('syncrolly');
    roomsCollection = db.collection('rooms');

    // Then start the HTTP server
    server.listen(PORT, () => {
      console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
