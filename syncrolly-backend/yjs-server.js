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

// Interval in ms for storing updates to LevelDB / Mongo
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
 * @param {string} roomName
 * @param {Y.Doc} ydoc
 */
async function syncToMongo(roomName, ydoc) {
  if (!roomsCollection) return;
  const content = ydoc.getText('shared-text').toString();
  console.log(`syncToMongo: roomName=${roomName}, content="${content.slice(0, 50)}"`);

  try {
    await roomsCollection.updateOne(
      { roomId: roomName },
      {
        $set: {
          text: content,
          lastActivity: new Date(),
        },
      },
      { upsert: true }
    );
    console.log(`Synced document ${roomName} to MongoDB`);
  } catch (error) {
    console.error(`Error syncing to MongoDB for room ${roomName}:`, error);
  }
}

/**
 * Load a Yjs doc from DB or LevelDB, or return `null` if not found
 * (meaning we do NOT want to create a new doc if the DB doesn't have it).
 */
async function loadOrNull(roomName) {
  // Check if it exists in MongoDB first
  const mongoDoc = await roomsCollection.findOne({ roomId: roomName });
  if (mongoDoc && typeof mongoDoc.text === 'string') {
    // Create a new Y.Doc and insert the text
    const ydoc = new Y.Doc();
    ydoc.getText('shared-text').insert(0, mongoDoc.text);
    console.log(`Loaded existing document "${roomName}" from MongoDB`);
    return ydoc;
  }

  // If not found in Mongo, try LevelDB
  const persistedDoc = await persistence.getYDoc(roomName);
  if (persistedDoc) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedDoc));
    console.log(`Loaded existing document "${roomName}" from LevelDB (no DB record)`);
    return ydoc;
  }

  // If not in DB nor in LevelDB, return null
  return null;
}

/**
 * Handle new WebSocket connections for Yjs collaboration.
 */
wss.on('connection', async (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0];

  // If we already have a Y.Doc in memory, reuse it
  if (documents.has(roomName)) {
    console.log(`Reusing in-memory doc for room: ${roomName}`);
  } else {
    // Attempt to load from DB or LevelDB
    const existingDoc = await loadOrNull(roomName);
    if (existingDoc) {
      documents.set(roomName, existingDoc);
    } else {
      // If the doc truly doesn't exist, don't create a new doc out of thin air.
      // You can either close the connection or just let them have an empty doc.
      // Here, we'll forcibly close:
      console.log(`No doc found for room "${roomName}". Closing connection.`);
      conn.close(); // forcibly close
      return;       // do not proceed
    }
  }

  const ydoc = documents.get(roomName);

  // Set up periodic persistence
  const persistenceInterval = setInterval(async () => {
    if (documents.has(roomName)) {
      try {
        const doc = documents.get(roomName);
        await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(doc));
        await syncToMongo(roomName, doc);
      } catch (error) {
        console.error(`Error in persistence interval for room ${roomName}:`, error);
      }
    } else {
      clearInterval(persistenceInterval);
    }
  }, PERSISTENCE_INTERVAL);

  // On socket close, do final sync
  conn.on('close', async () => {
    try {
      if (documents.has(roomName)) {
        const doc = documents.get(roomName);
        await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(doc));
        await syncToMongo(roomName, doc);
        console.log(`Final save completed for room ${roomName}`);
      }
    } catch (error) {
      console.error(`Error in final save for room ${roomName}:`, error);
    }
  });

  // Finally, set up the y-websocket connection
  setupWSConnection(conn, req, {
    docName: roomName,
    gc: true,
    gcFilter: () => false, // we can choose to disable GC for safety
    persistence,
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
