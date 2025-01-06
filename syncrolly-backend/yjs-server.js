// yjs-server.js

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
    console.log(`\nSync attempt for room "${roomName}":
    - Content length: ${content.length}
    - First 100 chars: ${content.substring(0, 100)}
    - Last update: ${new Date().toISOString()}`);

    const roomExists = await checkRoomExists(roomName);
    if (!roomExists) {
      console.error(`Room "${roomName}" does not exist in MongoDB; skipping sync`);
      return;
    }

    // Verify content before update
    console.log(`Pre-update content verification for "${roomName}":
    - Current content in Yjs: ${content.length} chars`);

    const result = await roomsCollection.updateOne(
      { roomId: roomName },
      { 
        $set: { 
          text: content,
          lastActivity: new Date(),
          lastSync: new Date()
        } 
      },
      { upsert: false }
    );

    if (result.matchedCount === 0) {
      console.error(`No document matched for room "${roomName}"`);
      return;
    }

    // Verify the update immediately
    const verifyDoc = await roomsCollection.findOne({ roomId: roomName });
    console.log(`Post-update verification for "${roomName}":
    - MongoDB content length: ${verifyDoc?.text?.length || 0}
    - Update successful: ${verifyDoc?.text === content}
    - ModifiedCount: ${result.modifiedCount}`);

    if (verifyDoc?.text !== content) {
      console.error('Content verification failed - MongoDB content does not match Yjs content');
      // Force a retry
      await roomsCollection.updateOne(
        { roomId: roomName },
        { $set: { text: content, lastActivity: new Date() } },
        { upsert: false }
      );
    }

  } catch (error) {
    console.error(`Error syncing "${roomName}" to MongoDB:`, error);
    throw error;
  }
};

// Debounce synchronization to MongoDB
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

// In your yjs-server.js, modify the connection handler section:

wss.on('connection', async (conn, request) => {
  const parsedUrl = url.parse(request.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0] || 'default-room';

  try {
    // Ensure room exists in MongoDB
    const roomExists = await checkRoomExists(roomName);
    if (!roomExists) {
      console.log(`Room "${roomName}" not found in MongoDB; closing connection`);
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
      docsMap.set(roomName, { ydoc, awareness, updateCount: 0 });
      docInfo = { ydoc, awareness, updateCount: 0 };

      // Set up more aggressive initial sync
      ydoc.on('update', async (update, origin) => {
        try {
          lastAccess.set(roomName, Date.now());
          docInfo.updateCount++;

          // Get the current content immediately after the update
          const content = ydoc.getText('shared-text').toString();
          console.log(`Update received for room "${roomName}". Content length: ${content.length}`);
          
          // Force an immediate sync for the first few updates
          if (docInfo.updateCount <= 3) {
            console.log(`Forcing immediate sync for update #${docInfo.updateCount}`);
            await syncToMongo(roomName, ydoc);
          } else {
            // Use debounced sync for subsequent updates
            debouncedSyncToMongo(roomName, ydoc);
          }
        } catch (error) {
          console.error(`Error handling update for "${roomName}":`, error);
        }
      });
    }

    const { ydoc, awareness } = docInfo;

    // Force an immediate sync when connection is established
    const content = ydoc.getText('shared-text').toString();
    console.log(`Initial connection content for "${roomName}". Length: ${content.length}`);
    await syncToMongo(roomName, ydoc);

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
