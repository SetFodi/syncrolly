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
    const ytext = ydoc.getText('shared-text');
    const content = ytext.toString();

    // Better content validation
    if (content === null || content === undefined) {
      console.error(`Invalid content for room "${roomName}" - sync aborted`);
      return;
    }

    console.log(`\nSync attempt for room "${roomName}":
      - Content length: ${content.length}
      - First 100 chars: "${content.substring(0, 100)}"
      - Content type: ${typeof content}
      - Timestamp: ${new Date().toISOString()}
    `);

    const roomExists = await checkRoomExists(roomName);
    if (!roomExists) {
      console.error(`Room "${roomName}" does not exist in MongoDB; skipping sync`);
      return;
    }

    // Compare with existing content before updating
    const existingDoc = await roomsCollection.findOne({ roomId: roomName });
    if (existingDoc?.text === content) {
      console.log(`Content unchanged for room "${roomName}" - skipping update`);
      return;
    }

    const result = await roomsCollection.updateOne(
      { roomId: roomName },
      { 
        $set: { 
          text: content,
          lastActivity: new Date(),
          lastSync: new Date(),
          contentLength: content.length // Add this for easier debugging
        } 
      },
      { upsert: false }
    );

    if (result.matchedCount === 0) {
      console.error(`No document matched for room "${roomName}"`);
      return;
    }

    // Enhanced verification
    const verifyDoc = await roomsCollection.findOne({ roomId: roomName });
    const verifyContent = verifyDoc?.text || '';
    
    console.log(`\nPost-update verification for "${roomName}":
      - MongoDB content length: ${verifyContent.length}
      - Yjs content length: ${content.length}
      - Length match: ${verifyContent.length === content.length}
      - Content match: ${verifyContent === content}
      - ModifiedCount: ${result.modifiedCount}
    `);

    if (verifyContent !== content) {
      console.error(`\nContent verification failed for "${roomName}":
        - Expected length: ${content.length}
        - Actual length: ${verifyContent.length}
        - First 100 chars expected: "${content.substring(0, 100)}"
        - First 100 chars actual: "${verifyContent.substring(0, 100)}"
      `);

      // Retry with explicit content check
      console.log('Attempting sync retry...');
      await roomsCollection.updateOne(
        { roomId: roomName },
        { 
          $set: { 
            text: content,
            lastActivity: new Date(),
            lastSync: new Date(),
            contentLength: content.length,
            retryCount: (verifyDoc.retryCount || 0) + 1
          } 
        },
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

    // Enhanced update handler with better content verification
    ydoc.on('update', async (update, origin) => {
        try {
            lastAccess.set(roomName, Date.now());
            docInfo.updateCount++;

            // Wait a small moment for the update to be applied
            setTimeout(async () => {
                // Get the current content immediately after the update
                const ytext = ydoc.getText('shared-text');
                const content = ytext.toString();
                
                console.log(`\nUpdate #${docInfo.updateCount} received for room "${roomName}":
                    - Update size: ${update.length} bytes
                    - Current content length: ${content.length}
                    - Content preview: "${content.substring(0, 100)}"
                    - Origin: ${origin}
                    - Timestamp: ${new Date().toISOString()}
                `);

                // Only sync if there's actual content
                const currentContent = ytext.toString();
                if (content !== null && content !== undefined) {
                    if (docInfo.updateCount <= 3) {
                        console.log(`Forcing immediate sync for update #${docInfo.updateCount}`);
                        await syncToMongo(roomName, ydoc);
                    } else {
                        console.log(`Debounced sync scheduled for update #${docInfo.updateCount}`);
                        debouncedSyncToMongo(roomName, ydoc);
                    }
                } else {
                    console.warn(`Update #${docInfo.updateCount} skipped - no valid content`);
                }
            }, 50); // Small delay to ensure update is applied

        } catch (error) {
            console.error(`Error handling update for "${roomName}":`, error);
        }
    });

    // Add a specific handler for text changes
    const ytext = ydoc.getText('shared-text');
    ytext.observe(event => {
        console.log(`\nText change observed in "${roomName}":
            - Delta length: ${event.changes.delta.length}
            - Current text length: ${ytext.toString().length}
            - Current text preview: "${ytext.toString().substring(0, 100)}"
        `);
    });
}

const { ydoc, awareness } = docInfo;

// Verify initial content
const initialContent = ydoc.getText('shared-text').toString();
console.log(`\nInitial connection state for "${roomName}":
    - Initial content length: ${initialContent.length}
    - Content preview: "${initialContent.substring(0, 100)}"
`);

// Force initial sync only if there's content
if (initialContent.length > 0) {
    await syncToMongo(roomName, ydoc);
}

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
