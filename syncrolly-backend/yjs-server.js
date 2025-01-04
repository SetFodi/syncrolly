/*******************************************************
 * yjs-server.js
 * Dedicated server for Yjs real-time editing
 *******************************************************/

const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils');
const { LeveldbPersistence } = require('y-leveldb');
const dotenv = require('dotenv');
const url = require('url');
const Y = require('yjs');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');

dotenv.config();

// -------- Mongo Setup --------
const MONGO_URI = process.env.MONGO_URI;
const mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
let roomsCollection;

// -------- Port Setup --------
const PORT = process.env.YJS_PORT || 1234;

// -------- Persistence --------
const persistenceDir = path.join(__dirname, 'yjs-docs');
if (!fs.existsSync(persistenceDir)) {
  fs.mkdirSync(persistenceDir);
}
const persistence = new LeveldbPersistence(persistenceDir);

const documents = new Map();  // roomName => Y.Doc
const PERSISTENCE_INTERVAL = 5000;

// -------- HTTP Server --------
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Yjs WebSocket Server');
});

// -------- WebSocket Server --------
const wss = new WebSocket.Server({ server });

/** 
 * Sync Yjs doc to Mongo 
 */
async function syncToMongo(roomName, ydoc) {
  if (!roomsCollection) return;
  const content = ydoc.getText('shared-text').toString();
  console.log(`syncToMongo: roomName=${roomName}, content="${content.slice(0, 50)}"`);

  try {
    await roomsCollection.updateOne(
      { roomId: roomName },
      { $set: { text: content, lastActivity: new Date() } },
      { upsert: true }
    );
    console.log(`Synced document ${roomName} to MongoDB`);
  } catch (error) {
    console.error(`Error syncing doc ${roomName} to MongoDB:`, error);
  }
}

/**
 * Load doc from DB or LevelDB. Returns null if not found
 */
async function loadExistingDoc(roomName) {
  // 1) Check Mongo
  const mongoDoc = await roomsCollection.findOne({ roomId: roomName });
  if (mongoDoc && typeof mongoDoc.text === 'string') {
    const ydoc = new Y.Doc();
    ydoc.getText('shared-text').insert(0, mongoDoc.text);
    console.log(`Loaded doc "${roomName}" from MongoDB`);
    return ydoc;
  }
  // 2) Check LevelDB
  const persisted = await persistence.getYDoc(roomName);
  if (persisted) {
    const ydoc = new Y.Doc();
    Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persisted));
    console.log(`Loaded doc "${roomName}" from LevelDB (no DB record)`);
    return ydoc;
  }
  return null;
}

/**
 * WebSocket connection handler
 */
wss.on('connection', async (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0];

  // Already in memory?
  if (!documents.has(roomName)) {
    const existingDoc = await loadExistingDoc(roomName);
    if (!existingDoc) {
      // If doc not found in DB or LevelDB, close
      console.log(`No doc found for room "${roomName}", closing socket.`);
      conn.close();
      return;
    }
    documents.set(roomName, existingDoc);
  }
  const ydoc = documents.get(roomName);

  // Start interval for persisting
  const intervalId = setInterval(async () => {
    if (!documents.has(roomName)) {
      clearInterval(intervalId);
      return;
    }
    try {
      await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc));
      await syncToMongo(roomName, ydoc);
    } catch (err) {
      console.error(`Error storing doc ${roomName}:`, err);
    }
  }, PERSISTENCE_INTERVAL);

  // On close => final store + sync
  conn.on('close', async () => {
    if (!documents.has(roomName)) return;
    try {
      await persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc));
      await syncToMongo(roomName, ydoc);
      console.log(`Final save for room "${roomName}"`);
    } catch (err) {
      console.error(`Error final saving doc ${roomName}:`, err);
    }
  });

  // Actually set up the Yjs connection
  setupWSConnection(conn, req, {
    docName: roomName,
    gc: true,
    gcFilter: () => false,
    persistence
  });
});

/**
 * Remove a doc from memory + LevelDB
 */
async function removeYjsDoc(roomId) {
  if (documents.has(roomId)) {
    documents.delete(roomId);
    console.log(`Removed doc "${roomId}" from memory`);
  }
  await persistence.clearDocument(roomId);
  console.log(`Removed doc "${roomId}" from LevelDB`);
}

/**
 * Start the Yjs server
 */
async function startYjsServer() {
  try {
    await mongoClient.connect();
    console.log('Yjs server connected to Mongo');
    const db = mongoClient.db('syncrolly');
    roomsCollection = db.collection('rooms');

    server.listen(PORT, () => {
      console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start Yjs server:', err);
    process.exit(1);
  }
}

// Export remove function (so the main server can call it if in same monorepo):
module.exports = {
  removeYjsDoc,
  persistence,
  documents
};

startYjsServer();
