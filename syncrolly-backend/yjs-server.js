import http from 'http';
import { WebSocketServer } from 'ws';
import { setupWSConnection } from 'y-websocket/bin/utils.js';
import { LeveldbPersistence } from 'y-leveldb';
import dotenv from 'dotenv';
import * as url from 'url';
import * as Y from 'yjs';
import { Awareness } from 'y-protocols/awareness.js';
import path from 'path';
import fs from 'fs';
import { MongoClient } from 'mongodb';
import debounce from 'lodash.debounce';

// For __dirname in ES modules
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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
const ldb = new LeveldbPersistence(persistenceDir);

// In-memory maps
const docsMap = new Map();
const lastAccess = new Map();

// Helper function to load document state
async function loadDocument(roomName) {
  try {
    const ydoc = new Y.Doc();
    const mongoDoc = await roomsCollection.findOne({ roomId: roomName });

    if (mongoDoc?.text) {
      ydoc.getText('shared-text').insert(0, mongoDoc.text);
      console.log(`Loaded content from MongoDB for room: ${roomName}`);
    } else {
      console.log(`No content found in MongoDB for room: ${roomName}.`);
    }

    return ydoc;
  } catch (err) {
    console.error(`Error loading document "${roomName}":`, err);
    throw err;
  }
}



async function checkRoomExists(roomName) {
  if (!roomsCollection) return false;
  const room = await roomsCollection.findOne({ roomId: roomName });
  return !!room;
}

const syncToMongo = async (roomName, ydoc) => {
  const content = ydoc.getText('shared-text').toString();
  if (!content.trim()) return; // Skip empty updates
  const roomExists = await checkRoomExists(roomName);
  if (!roomExists) return;

  const existingRoom = await roomsCollection.findOne({ roomId: roomName });
  if (existingRoom.text === content) {
    console.log(`No changes to save for room: ${roomName}`);
    return; // Avoid duplicate updates
  }

  await roomsCollection.updateOne(
    { roomId: roomName },
    { $set: { text: content, lastActivity: new Date() } }
  );
  console.log(`Synced room "${roomName}" to MongoDB`);
};
const debouncedSyncToMongo = debounce(async (roomName, ydoc) => {
  try {
    const content = ydoc.getText('shared-text').toString();
    if (!content.trim()) return;

    await roomsCollection.updateOne(
      { roomId: roomName },
      { $set: { text: content, lastActivity: new Date() } },
      { upsert: true }
    );
    console.log(`Room "${roomName}" content synced to MongoDB.`);
  } catch (error) {
    console.error(`Failed to sync room "${roomName}" to MongoDB:`, error);
  }
}, 1000);



async function cleanupDocument(roomName) {
    const docInfo = docsMap.get(roomName);
    if (!docInfo) return;

    const { ydoc } = docInfo;
    const content = ydoc.getText('shared-text').toString();

    await roomsCollection.updateOne(
        { roomId: roomName },
        { $set: { text: content, lastActivity: new Date() } },
        { upsert: true }
    );

    docsMap.delete(roomName);
    console.log(`Room "${roomName}" cleaned up and persisted.`);
}


const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Yjs WebSocket Server is running (ESM).');
});

const wss = new WebSocketServer({ server });

wss.on('connection', async (conn, request) => {
  const parsedUrl = url.parse(request.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0] || 'default-room';

  try {
    // Ensure the room exists in MongoDB
    const roomExists = await checkRoomExists(roomName);
    if (!roomExists) {
      console.log(`Room "${roomName}" not found in MongoDB; closing connection.`);
      conn.close();
      return;
    }

    // Update the last access time for the room
    lastAccess.set(roomName, Date.now());

    // Initialize or retrieve the document from memory or MongoDB
    let docInfo = docsMap.get(roomName);
    if (!docInfo) {
      console.log(`Room "${roomName}" not in memory, loading from MongoDB.`);
      const ydoc = await loadDocument(roomName); // Load document from MongoDB
      const awareness = new Awareness(ydoc);
      docInfo = { ydoc, awareness };
      docsMap.set(roomName, docInfo);

      // Listen for updates to synchronize with MongoDB
      ydoc.on('update', () => {
        debouncedSyncToMongo(roomName, ydoc); // Sync updates to MongoDB
      });
    }

    // Destructure the document information
    const { ydoc, awareness } = docInfo;

    // Set up the WebSocket connection with Yjs
    setupWSConnection(conn, request, {
      docName: roomName,
      gc: false, // Garbage collection disabled to retain state
      awareness,
    });

    // Periodic persistence to MongoDB and LevelDB
    const intervalId = setInterval(async () => {
      try {
        if (!docsMap.has(roomName)) {
          clearInterval(intervalId); // Stop interval if the room is no longer in memory
          return;
        }

        const stillExists = await checkRoomExists(roomName);
        if (!stillExists) {
          console.log(`Room "${roomName}" removed from MongoDB; clearing from memory.`);
          clearInterval(intervalId);
          docsMap.delete(roomName);
          lastAccess.delete(roomName);
          return;
        }

        const currentTime = Date.now();
        const lastTime = lastAccess.get(roomName) || 0;
        if (currentTime - lastTime > CLEANUP_TIMEOUT) {
          console.log(`Cleaning up room "${roomName}" due to inactivity.`);
          clearInterval(intervalId);
          await cleanupDocument(roomName); // Save and clean up the document
        } else {
          // Periodically save updates
          const update = Y.encodeStateAsUpdate(ydoc);
          await Promise.all([
            ldb.storeUpdate(roomName, update), // Save Yjs state to LevelDB
            syncToMongo(roomName, ydoc),      // Save content to MongoDB
          ]);
        }
      } catch (err) {
        console.error(`Error in persistence interval for room "${roomName}":`, err);
      }
    }, PERSISTENCE_INTERVAL);

    // Update last access time on document changes
    ydoc.on('update', () => {
      lastAccess.set(roomName, Date.now());
    });

    // Handle connection close
    conn.on('close', async () => {
      console.log(`Connection closed for room "${roomName}".`);
      try {
        if (docsMap.has(roomName)) {
          const stillExists = await checkRoomExists(roomName);
          if (stillExists) {
            const update = Y.encodeStateAsUpdate(ydoc);
            await Promise.all([
              ldb.storeUpdate(roomName, update),
              syncToMongo(roomName, ydoc),
            ]);
          }
        }
      } catch (err) {
        console.error(`Error during final save for room "${roomName}":`, err);
      }
    });

  } catch (err) {
    console.error(`Error handling connection for room "${roomName}":`, err);
    conn.close();
  }
});


// Periodic cleanup of stale rooms
setInterval(async () => {
  const now = Date.now();
  for (const [roomName, lastTime] of lastAccess.entries()) {
    if (now - lastTime > CLEANUP_TIMEOUT) {
      const stillExists = await checkRoomExists(roomName);
      if (!stillExists) {
        docsMap.delete(roomName);
        lastAccess.delete(roomName);
      } else {
        await cleanupDocument(roomName);
      }
    }
  }
}, CLEANUP_TIMEOUT);

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    console.log('Shutting down gracefully...');
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

// Start server
async function startServer() {
  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB');

    const db = mongoClient.db('syncrolly');
    roomsCollection = db.collection('rooms');

    server.listen(PORT, () => {
      console.log(`Yjs WebSocket server running on ws://localhost:${PORT} (ESM mode)`);
    });
  } catch (err) {
    console.error('Failed to start Yjs server:', err);
    process.exit(1);
  }
}

startServer();
