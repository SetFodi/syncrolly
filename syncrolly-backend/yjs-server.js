const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils.js');
const { LeveldbPersistence } = require('y-leveldb');
const dotenv = require('dotenv');
const url = require('url');
const Y = require('yjs');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');

dotenv.config();

const MONGO_URI = process.env.MONGO_URI;
const mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
let roomsCollection;

const PORT = process.env.YJS_PORT || 1234;
const PERSISTENCE_INTERVAL = 3000; // Reduced from 5000 to 3000 for more frequent saves
const CLEANUP_TIMEOUT = 30 * 60 * 1000; // 30 minutes before cleanup

// Enhanced persistence setup
const persistenceDir = path.join(__dirname, 'yjs-docs');
if (!fs.existsSync(persistenceDir)) {
  fs.mkdirSync(persistenceDir);
}

const persistence = new LeveldbPersistence(persistenceDir);
const documents = new Map();
const lastAccess = new Map(); // Track last access time for each document

// Enhanced MongoDB sync function with retry mechanism
async function syncToMongo(roomName, ydoc, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      if (!roomsCollection) return;
      
      const content = ydoc.getText('shared-text').toString();
      if (!content.trim()) return; // Don't save empty content
      
      await roomsCollection.updateOne(
        { roomId: roomName },
        { 
          $set: { 
            text: content,
            lastActivity: new Date(),
            lastSync: new Date()
          }
        },
        { upsert: true }
      );
      console.log(`Successfully synced document ${roomName} to MongoDB`);
      return true;
    } catch (error) {
      console.error(`Attempt ${i + 1} failed to sync to MongoDB for room ${roomName}:`, error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
    }
  }
}

// Document cleanup function
async function cleanupDocument(roomName) {
  try {
    const doc = documents.get(roomName);
    if (!doc) return;

    // Final sync to both storages
    await Promise.all([
      persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(doc)),
      syncToMongo(roomName, doc)
    ]);

    documents.delete(roomName);
    lastAccess.delete(roomName);
    console.log(`Cleaned up document ${roomName}`);
  } catch (error) {
    console.error(`Error cleaning up document ${roomName}:`, error);
  }
}

const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Yjs WebSocket Server');
});

const wss = new WebSocket.Server({ server });

wss.on('connection', async (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0];

  lastAccess.set(roomName, Date.now());
  
  let ydoc;
  if (documents.has(roomName)) {
    ydoc = documents.get(roomName);
  } else {
    ydoc = new Y.Doc();
    
    try {
      // Attempt to load from MongoDB first
      const mongoDoc = await roomsCollection?.findOne({ roomId: roomName });
      if (mongoDoc?.text) {
        const ytext = ydoc.getText('shared-text');
        ytext.delete(0, ytext.length);
        ytext.insert(0, mongoDoc.text);
        console.log(`Loaded document ${roomName} from MongoDB`);
      } else {
        // Fallback to LevelDB
        const persistedDoc = await persistence.getYDoc(roomName);
        if (persistedDoc) {
          Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(persistedDoc));
          console.log(`Loaded document ${roomName} from LevelDB`);
          // Sync to MongoDB for consistency
          await syncToMongo(roomName, ydoc);
        }
      }
    } catch (err) {
      console.error(`Error loading document ${roomName}:`, err);
    }
    
    documents.set(roomName, ydoc);
  }

  // Set up periodic persistence
  const persistenceInterval = setInterval(async () => {
    try {
      if (documents.has(roomName)) {
        const currentTime = Date.now();
        const lastAccessTime = lastAccess.get(roomName);

        if (currentTime - lastAccessTime > CLEANUP_TIMEOUT) {
          clearInterval(persistenceInterval);
          await cleanupDocument(roomName);
        } else {
          // Regular persistence
          await Promise.all([
            persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc)),
            syncToMongo(roomName, ydoc)
          ]);
        }
      } else {
        clearInterval(persistenceInterval);
      }
    } catch (error) {
      console.error(`Error in persistence interval for room ${roomName}:`, error);
    }
  }, PERSISTENCE_INTERVAL);

  // Update last access time on any document change
  ydoc.on('update', () => {
    lastAccess.set(roomName, Date.now());
  });

  conn.on('close', async () => {
    try {
      if (documents.has(roomName)) {
        await Promise.all([
          persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc)),
          syncToMongo(roomName, ydoc)
        ]);
        console.log(`Final save completed for room ${roomName}`);
      }
    } catch (error) {
      console.error(`Error in final save for room ${roomName}:`, error);
    }
  });

  setupWSConnection(conn, req, {
    docName: roomName,
    gc: true,
    gcFilter: () => false,
    persistence: persistence,
  });
});

// Periodic cleanup check
setInterval(async () => {
  const currentTime = Date.now();
  for (const [roomName, lastAccessTime] of lastAccess.entries()) {
    if (currentTime - lastAccessTime > CLEANUP_TIMEOUT) {
      await cleanupDocument(roomName);
    }
  }
}, CLEANUP_TIMEOUT);

async function startServer() {
  try {
    await mongoClient.connect();
    console.log('Connected to MongoDB');
    const db = mongoClient.db('syncrolly');
    roomsCollection = db.collection('rooms');

    server.listen(PORT, () => {
      console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  try {
    console.log('Gracefully shutting down...');
    // Final save for all documents
    await Promise.all(Array.from(documents.entries()).map(async ([roomName, doc]) => {
      await cleanupDocument(roomName);
    }));
    await mongoClient.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

startServer();
