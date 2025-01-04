/*************************************************************
 * yjs-server.js
 *************************************************************/

const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils.js');
const { LeveldbPersistence } = require('y-leveldb');
const dotenv = require('dotenv');
const url = require('url');
const Y = require('yjs');
const { Awareness } = require('y-protocols/awareness.js');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const mongoClient = new MongoClient(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});
let roomsCollection;

const PORT = process.env.YJS_PORT || 1234;
const PERSISTENCE_INTERVAL = 3000;
const CLEANUP_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Ensure "yjs-docs" dir exists
const persistenceDir = path.join(__dirname, 'yjs-docs');
if (!fs.existsSync(persistenceDir)) {
  fs.mkdirSync(persistenceDir);
}

// Set up LevelDB persistence
const persistence = new LeveldbPersistence(persistenceDir);

// In-memory maps
// Each roomName -> { ydoc, awareness }
const docsMap = new Map();
const lastAccess = new Map();

// ────────────────────────────────────────────────────────────────────────────────
// 1) Check if room exists in Mongo
// ────────────────────────────────────────────────────────────────────────────────
async function checkRoomExists(roomName) {
  if (!roomsCollection) return false;
  const room = await roomsCollection.findOne({ roomId: roomName });
  return !!room;
}

// ────────────────────────────────────────────────────────────────────────────────
// 2) Sync text content to Mongo (if non-empty)
// ────────────────────────────────────────────────────────────────────────────────
async function syncToMongo(roomName, ydoc, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const roomExists = await checkRoomExists(roomName);
      if (!roomExists) {
        console.log(`Room ${roomName} does not exist in MongoDB; skipping sync`);
        return false;
      }

      const content = ydoc.getText('shared-text').toString();
      if (!content.trim()) {
        // Don’t store empty or whitespace text
        return false;
      }

      await roomsCollection.updateOne(
        { roomId: roomName },
        {
          $set: {
            text: content,
            lastActivity: new Date(),
            lastSync: new Date(),
          },
        }
      );
      console.log(`Successfully synced document "${roomName}" to MongoDB`);
      return true;
    } catch (err) {
      console.error(
        `Attempt ${i + 1} to sync "${roomName}" to MongoDB failed:`,
        err
      );
      if (i === retries - 1) throw err; // rethrow on final failure
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────────
// 3) Cleanup doc from in-memory, storing final updates to LevelDB + Mongo
// ────────────────────────────────────────────────────────────────────────────────
async function cleanupDocument(roomName) {
  try {
    const docInfo = docsMap.get(roomName);
    if (!docInfo) return;

    const { ydoc } = docInfo;
    const roomExists = await checkRoomExists(roomName);
    if (roomExists) {
      // Persist final updates to LevelDB, then sync to Mongo
      await Promise.all([
        persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc)),
        syncToMongo(roomName, ydoc),
      ]);
    }

    docsMap.delete(roomName);
    lastAccess.delete(roomName);
    console.log(`Cleaned up document "${roomName}" (removed from memory).`);
  } catch (err) {
    console.error(`Error cleaning up document "${roomName}":`, err);
  }
}

// ────────────────────────────────────────────────────────────────────────────────
// 4) HTTP server + WebSocket server
// ────────────────────────────────────────────────────────────────────────────────
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Yjs WebSocket Server is running.');
});
const wss = new WebSocket.Server({ server });

wss.on('connection', async (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0]; // e.g. "/my-room" -> "my-room"

  // Ensure room exists in Mongo
  const roomExists = await checkRoomExists(roomName);
  if (!roomExists) {
    console.log(`Room "${roomName}" not found in Mongo; closing connection`);
    conn.close();
    return;
  }

  // Update last access time
  lastAccess.set(roomName, Date.now());

  // ──────────────────────────────────────────────────────────────────────────
  // 4A) Initialize or retrieve an existing doc + shared awareness for room
  // ──────────────────────────────────────────────────────────────────────────
  let docInfo = docsMap.get(roomName);
  if (!docInfo) {
    // Create a fresh Y.Doc + shared awareness
    const ydoc = new Y.Doc();
    const awareness = new Awareness(ydoc);

    try {
      // Load or create doc from LevelDB
      await persistence.bindState(roomName, ydoc);

      // Optionally patch in text from Mongo if doc is empty
      const mongoDoc = await roomsCollection.findOne({ roomId: roomName });
      const ytext = ydoc.getText('shared-text');
      if (mongoDoc?.text && !ytext.toString()) {
        ytext.insert(0, mongoDoc.text);
        console.log(`Loaded content from Mongo for "${roomName}" (Yjs was empty).`);
      }

      // Store in memory
      docsMap.set(roomName, { ydoc, awareness });
      docInfo = docsMap.get(roomName);
    } catch (err) {
      console.error(`Error binding/creating doc "${roomName}":`, err);
      conn.close();
      return;
    }
  }

  const { ydoc, awareness } = docInfo;

  // ──────────────────────────────────────────────────────────────────────────
  // 4B) Set up a regular persistence interval
  // ──────────────────────────────────────────────────────────────────────────
  const intervalId = setInterval(async () => {
    try {
      // If doc is gone from memory, stop
      if (!docsMap.has(roomName)) {
        clearInterval(intervalId);
        return;
      }

      // Check if Mongo still has this room
      const stillExists = await checkRoomExists(roomName);
      if (!stillExists) {
        clearInterval(intervalId);
        docsMap.delete(roomName);
        lastAccess.delete(roomName);
        console.log(`Room "${roomName}" removed from memory (deleted in Mongo).`);
        return;
      }

      // If room has been inactive beyond CLEANUP_TIMEOUT, finalize & remove
      const currentTime = Date.now();
      const lastTime = lastAccess.get(roomName) || 0;
      if (currentTime - lastTime > CLEANUP_TIMEOUT) {
        clearInterval(intervalId);
        await cleanupDocument(roomName);
      } else {
        // Otherwise, store updates regularly & sync
        await Promise.all([
          persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc)),
          syncToMongo(roomName, ydoc),
        ]);
      }
    } catch (err) {
      console.error(`Error in interval for room "${roomName}":`, err);
    }
  }, PERSISTENCE_INTERVAL);

  // Bump lastAccess whenever doc updates
  ydoc.on('update', () => {
    lastAccess.set(roomName, Date.now());
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4C) On close: store final updates if room still exists
  // ──────────────────────────────────────────────────────────────────────────
  conn.on('close', async () => {
    try {
      if (docsMap.has(roomName)) {
        const stillExists = await checkRoomExists(roomName);
        if (stillExists) {
          await Promise.all([
            persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc)),
            syncToMongo(roomName, ydoc),
          ]);
        }
      }
    } catch (err) {
      console.error(`Error during final save for "${roomName}":`, err);
    }
  });

  // ──────────────────────────────────────────────────────────────────────────
  // 4D) Finally, wire up the actual Yjs <-> WebSocket bridging
  //     Pass our shared doc + shared awareness for real-time updates
  // ──────────────────────────────────────────────────────────────────────────
  setupWSConnection(conn, req, {
    docName: roomName,
    gc: false, // Often recommended for multi-user code editors
    persistence, // so y-websocket can store state if needed
    awareness,   // <--- crucial for consistent real-time updates & presence
  });
});

// ────────────────────────────────────────────────────────────────────────────────
// 5) Periodic cleanup check for stale rooms
// ────────────────────────────────────────────────────────────────────────────────
setInterval(async () => {
  const now = Date.now();
  for (const [roomName, lastTime] of lastAccess.entries()) {
    if (now - lastTime > CLEANUP_TIMEOUT) {
      const stillExists = await checkRoomExists(roomName);
      if (!stillExists) {
        docsMap.delete(roomName);
        lastAccess.delete(roomName);
        console.log(`Removed room "${roomName}" from memory (doesn't exist in Mongo).`);
      } else {
        await cleanupDocument(roomName);
      }
    }
  }
}, CLEANUP_TIMEOUT);

// ────────────────────────────────────────────────────────────────────────────────
// 6) Start server & Mongo connection
// ────────────────────────────────────────────────────────────────────────────────
async function startServer() {
  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB');

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

// ────────────────────────────────────────────────────────────────────────────────
// 7) Graceful shutdown
// ────────────────────────────────────────────────────────────────────────────────
process.on('SIGINT', async () => {
  try {
    console.log('Shutting down gracefully...');
    // For each doc in memory, persist final updates & sync to Mongo
    const tasks = Array.from(docsMap.keys()).map(async (roomName) => {
      const stillExists = await checkRoomExists(roomName);
      if (stillExists) {
        await cleanupDocument(roomName);
      }
    });
    await Promise.all(tasks);

    await mongoClient.close();
    process.exit(0);
  } catch (err) {
    console.error('Error during shutdown:', err);
    process.exit(1);
  }
});

startServer();
