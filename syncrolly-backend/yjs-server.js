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
const PERSISTENCE_INTERVAL = 3000; // Note: Interval logic is commented out below
const CLEANUP_TIMEOUT = 30 * 60 * 1000; // 30 minutes

// Ensure "yjs-docs" dir exists
const persistenceDir = path.join(__dirname, 'yjs-docs');
if (!fs.existsSync(persistenceDir)) {
  fs.mkdirSync(persistenceDir);
}

// Set up LevelDB persistence (Optional, consider if needed alongside MongoDB)
const ldb = new LeveldbPersistence(persistenceDir);

// In-memory maps
const docsMap = new Map(); // Stores { ydoc, awareness } for active rooms
const lastAccess = new Map(); // Stores last activity timestamp for rooms

// Helper function to load document state from MongoDB
async function loadDocument(roomName) {
  try {
    const ydoc = new Y.Doc();
    // Ensure roomsCollection is initialized before using it
    if (!roomsCollection) {
      throw new Error('roomsCollection is not initialized');
    }
    const mongoDoc = await roomsCollection.findOne({ roomId: roomName });

    if (mongoDoc && typeof mongoDoc.text === 'string' && mongoDoc.text !== '') {
      // Apply the state from MongoDB to the Yjs document
      // Using applyUpdate might be more robust if storing Yjs updates directly
      // But inserting text works if you only store the final text content
      ydoc.getText('shared-text').insert(0, mongoDoc.text);
      console.log(`Loaded content from MongoDB for room: ${roomName}`);
    } else {
      console.log(
        `No content found or empty content in MongoDB for room: ${roomName}. Initializing empty Yjs doc.`,
      );
      // Ensure the 'shared-text' type exists even if empty
      ydoc.getText('shared-text');
    }

    // Ensure the room document exists in MongoDB with necessary fields
    await roomsCollection.updateOne(
      { roomId: roomName },
      {
        $setOnInsert: { text: '', lastActivity: new Date() }, // Set only on insert
        $set: { lastActivity: new Date() }, // Always update lastActivity
      },
      { upsert: true },
    );

    return ydoc;
  } catch (err) {
    console.error(`Error loading document "${roomName}":`, err);
    // Don't rethrow here, return a new empty doc as fallback
    // Or handle the error more gracefully depending on requirements
    return new Y.Doc(); // Return a default empty doc on error
  }
}

// Helper function to check if a room exists in MongoDB
async function checkRoomExists(roomName) {
  if (!roomsCollection) {
    console.warn('checkRoomExists called before roomsCollection initialized.');
    return false;
  }
  try {
    const room = await roomsCollection.findOne({ roomId: roomName });
    return !!room;
  } catch (err) {
    console.error(`Error checking existence for room "${roomName}":`, err);
    return false; // Assume not exists on error
  }
}

// Function to sync Yjs document content to MongoDB
const syncToMongo = async (roomName, ydoc) => {
  if (!roomsCollection) {
    console.warn('syncToMongo called before roomsCollection initialized.');
    return;
  }
  try {
    const content = ydoc.getText('shared-text').toString();

    // Check if the room still exists before attempting to update
    const roomExists = await checkRoomExists(roomName);
    if (!roomExists) {
      console.log(
        `Skipping sync for room "${roomName}" as it no longer exists in DB.`,
      );
      // Clean up memory if the room was deleted from DB while active
      if (docsMap.has(roomName)) {
        docsMap.delete(roomName);
        lastAccess.delete(roomName);
        console.log(
          `Removed non-existent room "${roomName}" from memory during sync attempt.`,
        );
      }
      return;
    }

    const existingRoom = await roomsCollection.findOne({ roomId: roomName });

    // Avoid unnecessary writes if content hasn't changed
    if (existingRoom && existingRoom.text === content) {
      // console.log(`No changes to save for room: ${roomName}`); // Reduce log noise
      // Still update lastActivity even if text is the same
      await roomsCollection.updateOne(
        { roomId: roomName },
        { $set: { lastActivity: new Date() } },
      );
      return;
    }

    // Update text content and last activity time
    await roomsCollection.updateOne(
      { roomId: roomName },
      { $set: { text: content, lastActivity: new Date() } },
    );
    console.log(`Synced room "${roomName}" to MongoDB`);
  } catch (err) {
    console.error(`Error syncing room "${roomName}" to MongoDB:`, err);
  }
};

// Debounced version of the sync function to limit DB writes
const debouncedSyncToMongo = debounce(async (roomName, ydoc) => {
  // Check if the document is still loaded in memory before syncing
  if (docsMap.has(roomName)) {
    await syncToMongo(roomName, ydoc);
  } else {
    console.log(
      `Skipping debounced sync for "${roomName}"; document no longer in memory.`,
    );
  }
}, 2000); // Debounce interval: 2 seconds

// Function to clean up document from memory and ensure final save
async function cleanupDocument(roomName) {
  const docInfo = docsMap.get(roomName);
  if (!docInfo) return;

  const { ydoc } = docInfo;

  try {
    // Cancel any pending debounced saves for this room
    debouncedSyncToMongo.cancel(roomName, ydoc);
    // Perform a final immediate sync before removing from memory
    console.log(`Performing final sync for room "${roomName}" before cleanup.`);
    await syncToMongo(roomName, ydoc);

    // Optional: Persist final Yjs state update to LevelDB if using it
    // const finalUpdate = Y.encodeStateAsUpdate(ydoc);
    // await ldb.storeUpdate(roomName, finalUpdate);
    // console.log(`Stored final Yjs update to LevelDB for room "${roomName}".`);
  } catch (error) {
    console.error(
      `Error during final sync/persistence before cleanup for room "${roomName}":`,
      error,
    );
  } finally {
    // Destroy the Yjs document and awareness instance to free resources
    ydoc.destroy();
    if (docInfo.awareness) {
      docInfo.awareness.destroy();
    }
    // Remove from in-memory maps
    docsMap.delete(roomName);
    lastAccess.delete(roomName);
    console.log(`Room "${roomName}" cleaned up from memory.`);
  }
}

// --- HTTP SERVER SETUP ---
// This server handles both WebSocket upgrade requests and standard HTTP requests (like /health)
const server = http.createServer((req, res) => {
  // Health check endpoint
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('YJS OK'); // Signal that the Yjs server process is running
  } else {
    // Default response for any other HTTP requests
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Yjs WebSocket Server is running.');
  }
});
// --- END HTTP SERVER SETUP ---

// --- WEBSOCKET SERVER SETUP ---
// Attach WebSocket server to the HTTP server
const wss = new WebSocketServer({ server });

wss.on('connection', async (conn, request) => {
  let roomName = 'default-room'; // Default room name
  try {
    const parsedUrl = url.parse(request.url, true);
    // Extract room name from the path, removing leading slash and query params
    roomName = parsedUrl.pathname?.slice(1).split('?')[0] || roomName;

    console.log(`Connection attempt for room: "${roomName}"`);

    // IMPORTANT: Check if the room exists in MongoDB *before* proceeding
    const roomExists = await checkRoomExists(roomName);
    if (!roomExists) {
      console.warn(
        `Connection rejected: Room "${roomName}" not found in MongoDB.`,
      );
      conn.close(1011, 'Room not found'); // 1011: Internal Error preventing fulfillment
      return;
    }

    // Room exists, proceed with connection setup
    console.log(`Room "${roomName}" confirmed in MongoDB. Setting up connection.`);

    // Update last access time for the room
    lastAccess.set(roomName, Date.now());

    // Get or load the Yjs document and awareness instance
    let docInfo = docsMap.get(roomName);
    if (!docInfo || !docInfo.ydoc) {
      console.log(`Loading document for room "${roomName}" from persistence.`);
      const ydoc = await loadDocument(roomName); // Load from MongoDB
      const awareness = new Awareness(ydoc);
      awareness.on('destroy', () => {
        console.log(`Awareness destroyed for room ${roomName}`);
      });
      awareness.on('update', (changes, origin) => {
        // Optional: Log awareness changes
        // console.log(`Awareness update in room ${roomName}:`, changes);
        lastAccess.set(roomName, Date.now()); // Update activity on awareness change
      });

      docInfo = { ydoc, awareness };
      docsMap.set(roomName, docInfo);
      console.log(`Document and awareness initialized for room "${roomName}".`);

      // Set up listener for Yjs document updates to trigger persistence
      ydoc.on('update', (update, origin, doc) => {
        // Persist changes using the debounced function
        debouncedSyncToMongo(roomName, doc);
        // Optional: Persist raw Yjs updates to LevelDB frequently
        // ldb.storeUpdate(roomName, update).catch(err => console.error(`LevelDB store error: ${err}`));
        lastAccess.set(roomName, Date.now()); // Update activity on doc change
      });

      ydoc.on('destroy', () => {
        console.log(`Yjs document destroyed for room ${roomName}`);
        // Ensure cleanup if the doc is destroyed unexpectedly
        cleanupDocument(roomName);
      });
    } else {
      console.log(`Reusing existing document/awareness for room "${roomName}".`);
      // Ensure last access is updated even when reusing existing doc
      lastAccess.set(roomName, Date.now());
    }

    // Use the existing or newly created ydoc and awareness
    const { ydoc, awareness } = docInfo;

    // Set up the Yjs WebSocket connection handling
    setupWSConnection(conn, request, {
      doc: ydoc, // Pass the specific Y.Doc instance
      awareness: awareness, // Pass the specific Awareness instance
      gc: false, // Disable Yjs garbage collection if managing persistence manually
    });

    // Handle connection closure
    conn.on('close', (code, reason) => {
      console.log(
        `Connection closed for room "${roomName}". Code: ${code}, Reason: ${reason?.toString()}`,
      );
      // Check if this was the last connection for the room's awareness
      const awarenessStateCount = docInfo?.awareness?.getStates().size || 0;
      console.log(
        `Awareness states remaining for room "${roomName}": ${awarenessStateCount}`,
      );

      // Optional: Trigger cleanup immediately if no users are left
      // if (awarenessStateCount === 0 && docsMap.has(roomName)) {
      //   console.log(`Last user disconnected from room "${roomName}". Scheduling cleanup.`);
      //   // Debounce cleanup slightly to handle quick reconnects
      //   setTimeout(() => {
      //       // Re-check count before cleaning
      //       if ((docInfo?.awareness?.getStates().size || 0) === 0 && docsMap.has(roomName)) {
      //           cleanupDocument(roomName);
      //       }
      //   }, 5000); // e.g., wait 5 seconds
      // }

      // Ensure final state is flushed if the document is still in memory
      if (docsMap.has(roomName)) {
        debouncedSyncToMongo.flush(roomName, ydoc);
      }
    });

    conn.on('error', (error) => {
      console.error(`WebSocket error on connection for room "${roomName}":`, error);
      // Ensure cleanup resources associated with this connection/room if needed
      cleanupDocument(roomName); // Consider if cleanup is appropriate on error
      conn.close(1011, 'WebSocket error');
    });
  } catch (err) {
    console.error(`Error setting up connection for room "${roomName}":`, err);
    // Attempt to close the connection gracefully if possible
    if (conn && conn.readyState === conn.OPEN) {
      conn.close(1011, 'Internal server error during connection setup');
    }
  }
});
// --- END WEBSOCKET SERVER SETUP ---

// --- PERIODIC CLEANUP ---
// Interval to check for inactive rooms in memory and clean them up
setInterval(async () => {
  const now = Date.now();
  console.log(
    `Running periodic memory cleanup check. ${docsMap.size} docs in memory.`,
  );
  for (const [roomName, lastTime] of lastAccess.entries()) {
    // Check if the room is still in the docsMap before cleaning up
    if (docsMap.has(roomName) && now - lastTime > CLEANUP_TIMEOUT) {
      console.log(
        `Room "${roomName}" exceeded inactivity timeout (${
          CLEANUP_TIMEOUT / 60000
        } min). Cleaning up from memory.`,
      );
      // Ensure the document exists before attempting cleanup
      const docInfo = docsMap.get(roomName);
      if (docInfo) {
        await cleanupDocument(roomName); // Saves final state and removes from maps
      } else {
        // If docInfo is missing but lastAccess entry exists, clean up lastAccess too
        lastAccess.delete(roomName);
      }
    }
  }
}, CLEANUP_TIMEOUT / 2); // Check frequency (e.g., every 15 minutes)
// --- END PERIODIC CLEANUP ---

// --- GRACEFUL SHUTDOWN ---
async function gracefulShutdown() {
  console.log('Attempting graceful shutdown...');
  // Stop accepting new connections
  wss.close(() => {
    console.log('WebSocket server closed.');
  });
  server.close(async () => {
    console.log('HTTP server closed.');
    // Perform final cleanup for all documents in memory
    const cleanupTasks = Array.from(docsMap.keys()).map((roomName) =>
      cleanupDocument(roomName),
    );
    try {
      await Promise.all(cleanupTasks);
      console.log('All active documents saved and cleaned up.');
    } catch (err) {
      console.error('Error during final document cleanup:', err);
    } finally {
      // Close MongoDB connection
      if (mongoClient) {
        await mongoClient.close();
        console.log('MongoDB connection closed.');
      }
      // Close LevelDB connection if used
      // await ldb.destroy(); // Or ldb.close() depending on the library version
      // console.log('LevelDB connection closed.');
      process.exit(0); // Exit cleanly
    }
  });

  // Force exit after a timeout if shutdown hangs
  setTimeout(() => {
    console.error('Graceful shutdown timed out. Forcing exit.');
    process.exit(1);
  }, 10000); // 10 seconds timeout
}

process.on('SIGINT', gracefulShutdown); // Ctrl+C
process.on('SIGTERM', gracefulShutdown); // Termination signal from OS/Render
// --- END GRACEFUL SHUTDOWN ---

// --- SERVER START ---
async function startServer() {
  try {
    // Connect to MongoDB
    await mongoClient.connect();
    console.log('Connected successfully to MongoDB');
    const db = mongoClient.db('syncrolly'); // Use your database name
    roomsCollection = db.collection('rooms'); // Assign to the global variable

    // Start the HTTP server (which includes WebSocket handling)
    server.listen(PORT, '0.0.0.0', () => {
      // Listen on 0.0.0.0 to be accessible externally (important for Render)
      console.log(
        `Yjs WebSocket server running on ws://localhost:${PORT} (and http://localhost:${PORT}/health for checks)`,
      );
      console.log(`Accessible externally at port ${PORT}`);
    });
  } catch (err) {
    console.error('Failed to start Yjs server:', err);
    process.exit(1); // Exit if server fails to start
  }
}

startServer();
// --- END SERVER START ---
