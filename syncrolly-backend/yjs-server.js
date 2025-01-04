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

// Interval in ms for storing updates
const PERSISTENCE_INTERVAL = 5000;

// Keep Y.Doc references in memory
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
 */
async function syncToMongo(roomName, ydoc) {
  try {
    if (!roomsCollection) return;

    const content = ydoc.getText('shared-text').toString();
    console.log(`syncToMongo: roomName=${roomName}, content="${content.slice(0, 50)}"`);

    // Upsert the doc in Mongo
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
 * Loads an existing Y.Doc from either DB or LevelDB
 * Returns `null` if doc is truly not found.
 */
async function loadExistingDoc(roomName) {
  // 1) Check Mongo first
  const mongoDoc = await roomsCollection.findOne({ roomId: roomName });
  if (mongoDoc && typeof mongoDoc.text === 'string') {
    const ydoc = new Y.Doc();
    ydoc.getText('shared-text').insert(0, mongoDoc.text);
    console.log(`Loaded document "${roomName}" from MongoDB`);
    return ydoc;
  }

  // 2) If not in Mongo, check LevelDB
  const persistedDoc = await persistence.getYDoc(roomName);
  if (persistedDoc) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedDoc));
    console.log(`Loaded document "${roomName}" from LevelDB (no DB record)`);
    return ydoc;
  }

  // 3) If neither DB nor LevelDB have it, return null
  return null;
}

/**
 * Handles new WebSocket connections for Yjs collaboration.
 */
wss.on('connection', async (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0];

  // Already in memory?
  if (!documents.has(roomName)) {
    // Not in memory, attempt to load from DB or LevelDB
    const existingDoc = await loadExistingDoc(roomName);
    if (!existingDoc) {
      // No doc found => forcibly close to avoid recreating
      console.log(`No existing doc for room "${roomName}". Closing connection.`);
      conn.close();
      return;
    }

    // Otherwise, we have an existing doc
    documents.set(roomName, existingDoc);
  }

  // Now we definitely have a doc in memory
  const ydoc = documents.get(roomName);

  // Set up a persistence interval
  const persistenceInterval = setInterval(async () => {
    if (!documents.has(roomName)) {
      clearInterval(persistenceInterval);
      return;
    }
    try {
      // Store updates in LevelDB
      await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc));
      // Also sync to Mongo
      await syncToMongo(roomName, ydoc);
    } catch (error) {
      console.error(`Error in persistence interval for room ${roomName}:`, error);
    }
  }, PERSISTENCE_INTERVAL);

  // On socket close, do final sync
  conn.on('close', async () => {
    if (!documents.has(roomName)) return;
    try {
      await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc));
      await syncToMongo(roomName, ydoc);
      console.log(`Final save completed for room ${roomName}`);
    } catch (error) {
      console.error(`Error in final save for room ${roomName}:`, error);
    }
  });

  // Setup the Yjs WebSocket connection
  setupWSConnection(conn, req, {
    docName: roomName,
    gc: true,
    gcFilter: () => false,
    persistence
  });
});

/**
 * Starts the Yjs WebSocket server.
 */
async function startServer() {
  try {
    // Connect to MongoDB
    await mongoClient.connect();
    console.log('Connected to MongoDB');
    const db = mongoClient.db('syncrolly');
    roomsCollection = db.collection('rooms');

    // Start the HTTP server
    server.listen(PORT, () => {
      console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
