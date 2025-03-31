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

// Use PORT provided by Render first, fallback for local dev
const PORT = process.env.PORT || 1234;
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

    if (mongoDoc && typeof mongoDoc.text === 'string' && mongoDoc.text !== '') {
      ydoc.getText('shared-text').insert(0, mongoDoc.text);
      console.log(`Loaded content from MongoDB for room: ${roomName}`);
    } else {
      console.log(
        `No content found in MongoDB for room: ${roomName}. Leaving Yjs document unchanged.`,
      );
    }

    // Optionally, initialize the 'text' field in MongoDB if it doesn't exist
    await roomsCollection.updateOne(
      { roomId: roomName },
      { $set: { text: '', lastActivity: new Date() } },
      { upsert: true },
    );

    return ydoc;
  } catch (err) {
    console.error(`Error loading document "${roomName}":`, err);
    throw err; // Rethrow the error to propagate it
  }
}

async function checkRoomExists(roomName) {
  if (!roomsCollection) return false;
  const room = await roomsCollection.findOne({ roomId: roomName });
  return !!room;
}

const syncToMongo = async (roomName, ydoc) => {
  const content = ydoc.getText('shared-text').toString();
  // Skip empty updates unless the document in DB is not empty (to clear it)
  const roomExists = await checkRoomExists(roomName);
  if (!roomExists) return;

  const existingRoom = await roomsCollection.findOne({ roomId: roomName });

  if (!content.trim() && existingRoom && !existingRoom.text) {
      console.log(`Skipping empty sync for already empty room: ${roomName}`);
      return; // Avoid syncing empty content if DB is already empty
  }

  if (existingRoom && existingRoom.text === content) {
    // console.log(`No changes to save for room: ${roomName}`); // Reduce log noise
    return; // Avoid duplicate updates
  }

  await roomsCollection.updateOne(
    { roomId: roomName },
    { $set: { text: content, lastActivity: new Date() } },
  );
  console.log(`Synced room "${roomName}" to MongoDB`);
};

const debouncedSyncToMongo = debounce(async (roomName, ydoc) => {
  try {
    await syncToMongo(roomName, ydoc); // Use the refined syncToMongo
  } catch (error) {
    console.error(`Failed to sync room "${roomName}" to MongoDB:`, error);
  }
}, 2000); // Increased debounce time slightly

async function cleanupDocument(roomName) {
  const docInfo = docsMap.get(roomName);
  if (!docInfo) return;

  const { ydoc } = docInfo;

  try {
    // Ensure final state is saved before cleanup
    await syncToMongo(roomName, ydoc);
  } catch (error) {
      console.error(`Error during final sync before cleanup for room "${roomName}":`, error);
  }

  docsMap.delete(roomName);
  lastAccess.delete(roomName); // Also remove from lastAccess map
  console.log(`Room "${roomName}" cleaned up from memory.`);
}

// --- MODIFIED HTTP SERVER ---
const server = http.createServer((req, res) => {
  // Check if it's a health check request
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('YJS OK');
  } else {
    // Original response for non-health checks (e.g., if someone accesses via HTTP)
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Yjs WebSocket Server is running (ESM).');
  }
});
// --- END MODIFICATION ---

const wss = new WebSocketServer({ server });

wss.on('connection', async (conn, request) => {
  const parsedUrl = url.parse(request.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0] || 'default-room';

  try {
    // Ensure the room exists in MongoDB before proceeding
    const roomExists = await checkRoomExists(roomName);
    if (!roomExists) {
      console.log(
        `Room "${roomName}" not found in MongoDB; closing connection.`,
      );
      conn.close(1011, 'Room not found'); // Use appropriate close code
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
      // Set initial awareness state if needed (e.g., user name)
      // awareness.setLocalStateField('user', { name: 'Default User' }); // Example
      docInfo = { ydoc, awareness };
      docsMap.set(roomName, docInfo);

      // Listen for updates to synchronize with MongoDB
      ydoc.on('update', () => {
        lastAccess.set(roomName, Date.now()); // Update access time on activity
        debouncedSyncToMongo(roomName, ydoc); // Sync updates to MongoDB
      });
    }

    // Destructure the document information
    const { ydoc, awareness } = docInfo;

    // Set up the WebSocket connection with Yjs
    setupWSConnection(conn, request, {
      docName: roomName,
      gc: false, // Garbage collection disabled to retain state longer
      awareness,
    });

    // Periodic persistence to MongoDB and LevelDB
    // This interval might be redundant if debouncedSyncToMongo works well
    // Consider removing or adjusting if causing issues
    /*
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
          // Periodically save updates (potentially redundant with debounce)
          // const update = Y.encodeStateAsUpdate(ydoc);
          // await Promise.all([
          //   ldb.storeUpdate(roomName, update), // Save Yjs state to LevelDB
          //   syncToMongo(roomName, ydoc),      // Save content to MongoDB
          // ]);
        }
      } catch (err) {
        console.error(`Error in persistence interval for room "${roomName}":`, err);
      }
    }, PERSISTENCE_INTERVAL);
    */

    // Handle connection close
    conn.on('close', async () => {
      console.log(`Connection closed for room "${roomName}".`);
      // Final sync attempt on close might still be useful
      try {
        if (docsMap.has(roomName)) {
          const stillExists = await checkRoomExists(roomName);
          if (stillExists) {
            const { ydoc: closingYdoc } = docsMap.get(roomName);
            // Ensure the debounced save runs if pending
            debouncedSyncToMongo.flush(roomName, closingYdoc);
            // Optionally save to LevelDB one last time
            // const update = Y.encodeStateAsUpdate(closingYdoc);
            // await ldb.storeUpdate(roomName, update);
          }
        }
      } catch (err) {
        console.error(`Error during final save for room "${roomName}":`, err);
      }
      // Consider if cleanup should happen based on awareness count instead of just close
    });
  } catch (err) {
    console.error(`Error handling connection for room "${roomName}":`, err);
    conn.close(1011, 'Internal server error');
  }
});

// Periodic cleanup of stale rooms from memory
setInterval(async () => {
  const now = Date.now();
  console.log('Running periodic memory cleanup check...');
  for (const [roomName, lastTime] of lastAccess.entries()) {
    if (now - lastTime > CLEANUP_TIMEOUT) {
      console.log(
        `Room "${roomName}" exceeded inactivity timeout. Cleaning up from memory.`,
      );
      await cleanupDocument(roomName); // Saves final state and removes from map
    }
  }
}, CLEANUP_TIMEOUT / 2); // Check more frequently than the timeout itself

// Graceful shutdown
process.on('SIGINT', async () => {
  try {
    console.log('Shutting down gracefully...');
    const cleanupTasks = Array.from(docsMap.keys()).map((roomName) =>
      cleanupDocument(roomName),
    );
    await Promise.all(cleanupTasks);
    await mongoClient.close();
    console.log('MongoDB connection closed.');
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
    // Ensure roomsCollection is accessible globally within this module
    // Assign it directly without redeclaring with let/const
    roomsCollection = db.collection('rooms');

    server.listen(PORT, () => {
      console.log(
        `Yjs WebSocket server running on ws://localhost:${PORT} (ESM mode)`,
      );
    });
  } catch (err) {
    console.error('Failed to start Yjs server:', err);
    process.exit(1);
  }
}

startServer();
