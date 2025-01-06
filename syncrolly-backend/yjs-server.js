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
        const ydoc = new Y.Doc(); // Start with a fresh Yjs document

        // Load content from MongoDB
        const mongoDoc = await roomsCollection.findOne({ roomId: roomName });
        if (mongoDoc?.text) {
            ydoc.getText('shared-text').insert(0, mongoDoc.text);
            console.log(`Loaded initial content from MongoDB for room: ${roomName}`);
        } else {
            console.log(`No content found in MongoDB for room: ${roomName}`);
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
  try {
    const content = ydoc.getText('shared-text').toString();
    
    // Even if content is empty, we should still sync it
    // Remove the early return for empty content
    // if (!content.trim()) return;

    const roomExists = await checkRoomExists(roomName);
    if (!roomExists) {
      console.log(`Room "${roomName}" does not exist in MongoDB; skipping sync`);
      return;
    }

    await roomsCollection.updateOne(
      { roomId: roomName },
      { 
        $set: { 
          text: content, 
          lastActivity: new Date(),
          lastSync: new Date() // Add a timestamp for the last successful sync
        } 
      }
    );
    console.log(`Successfully synced document "${roomName}" to MongoDB with ${content.length} characters`);
  } catch (error) {
    console.error(`Error syncing "${roomName}" to MongoDB:`, error);
  }
};

// Reduce the debounce time to ensure more frequent saves
const debouncedSyncToMongo = debounce(syncToMongo, 1000); 




async function cleanupDocument(roomName) {
    try {
        const docInfo = docsMap.get(roomName);
        if (!docInfo) return;

        const { ydoc } = docInfo;

        const roomExists = await checkRoomExists(roomName);
        if (roomExists) {
            const update = Y.encodeStateAsUpdate(ydoc);
            await Promise.all([
                ldb.storeUpdate(roomName, update), // Save Yjs state to LevelDB.
                syncToMongo(roomName, ydoc),      // Save content to MongoDB.
            ]);
        }

        docsMap.delete(roomName);
        lastAccess.delete(roomName);
        console.log(`Cleaned up document "${roomName}" (removed from memory)`);
    } catch (err) {
        console.error(`Error cleaning up document "${roomName}":`, err);
    }
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
    // Ensure room exists in Mongo
    const roomExists = await checkRoomExists(roomName);
    if (!roomExists) {
      console.log(`Room "${roomName}" not found in Mongo; closing connection`);
      conn.close();
      return;
    }

    // Update last access time
    lastAccess.set(roomName, Date.now());

    // Initialize or retrieve document
    let docInfo = docsMap.get(roomName);
    if (!docInfo) {
      const ydoc = await loadDocument(roomName);
      const awareness = new Awareness(ydoc);
      docsMap.set(roomName, { ydoc, awareness });
      docInfo = { ydoc, awareness };
      
      // Set up more aggressive initial sync
      ydoc.on('update', (update, origin) => {
        lastAccess.set(roomName, Date.now());
        debouncedSyncToMongo(roomName, ydoc);
        
        // Force an immediate sync for the first update
        if (!docInfo.hadFirstSync) {
          syncToMongo(roomName, ydoc);
          docInfo.hadFirstSync = true;
        }
      });
    }

    const { ydoc, awareness } = docInfo;

    // Force a sync when connection is established
    await syncToMongo(roomName, ydoc);

    // Set up persistence interval
    const intervalId = setInterval(async () => {
      try {
        if (!docsMap.has(roomName)) {
          clearInterval(intervalId);
          return;
        }

        const stillExists = await checkRoomExists(roomName);
        if (!stillExists) {
          clearInterval(intervalId);
          docsMap.delete(roomName);
          lastAccess.delete(roomName);
          return;
        }

        const currentTime = Date.now();
        const lastTime = lastAccess.get(roomName) || 0;
        if (currentTime - lastTime > CLEANUP_TIMEOUT) {
          clearInterval(intervalId);
          await cleanupDocument(roomName);
        } else {
          const update = Y.encodeStateAsUpdate(ydoc);
          await Promise.all([
            ldb.storeUpdate(roomName, update),
            syncToMongo(roomName, ydoc),
          ]);
        }
      } catch (err) {
        console.error(`Error in interval for room "${roomName}":`, err);
      }
    }, PERSISTENCE_INTERVAL);

    // Update lastAccess on document changes
    ydoc.on('update', () => {
      lastAccess.set(roomName, Date.now());
    });

    // Handle connection close
    conn.on('close', async () => {
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
        console.error(`Error during final save for "${roomName}":`, err);
      }
    });

    // Set up WebSocket connection
    setupWSConnection(conn, request, {
      docName: roomName,
      gc: false,
      awareness,
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
