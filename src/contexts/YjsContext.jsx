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
const PERSISTENCE_INTERVAL = 3000;
const CLEANUP_TIMEOUT = 30 * 60 * 1000;

const persistenceDir = path.join(__dirname, 'yjs-docs');
if (!fs.existsSync(persistenceDir)) {
  fs.mkdirSync(persistenceDir);
}

const persistence = new LeveldbPersistence(persistenceDir);
const documents = new Map();
const lastAccess = new Map();

// Modified to be less strict - just check if we can connect to MongoDB
async function canAccessMongo() {
  return !!roomsCollection;
}

async function syncToMongo(roomName, ydoc, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      if (!await canAccessMongo()) {
        console.log('MongoDB not accessible, skipping sync');
        return false;
      }

      const content = ydoc.getText('shared-text').toString();
      if (!content.trim()) return false;

      // Try to find the room first
      const room = await roomsCollection.findOne({ roomId: roomName });
      
      if (room) {
        // Update existing room
        await roomsCollection.updateOne(
          { roomId: roomName },
          { 
            $set: { 
              text: content,
              lastActivity: new Date(),
              lastSync: new Date()
            }
          }
        );
        console.log(`Successfully synced document ${roomName} to MongoDB`);
      } else {
        console.log(`Room ${roomName} doesn't exist in MongoDB yet, waiting for Socket.IO to create it`);
      }
      return true;
    } catch (error) {
      console.error(`Attempt ${i + 1} failed to sync to MongoDB for room ${roomName}:`, error);
      if (i === retries - 1) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

async function cleanupDocument(roomName) {
  try {
    const doc = documents.get(roomName);
    if (!doc) return;

    if (await canAccessMongo()) {
      await Promise.all([
        persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(doc)),
        syncToMongo(roomName, doc)
      ]);
    }

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
    console.log(`Using existing Y.Doc for room ${roomName}`);
  } else {
    ydoc = new Y.Doc();
    console.log(`Created new Y.Doc for room ${roomName}`);
    
    try {
      if (await canAccessMongo()) {
        const mongoDoc = await roomsCollection.findOne({ roomId: roomName });
        if (mongoDoc?.text) {
          const ytext = ydoc.getText('shared-text');
          if (!ytext.toString()) {
            ytext.insert(0, mongoDoc.text);
            console.log(`Loaded document ${roomName} from MongoDB`);
          }
        }
      }
      documents.set(roomName, ydoc);
    } catch (err) {
      console.error(`Error initializing document ${roomName}:`, err);
      // Continue anyway - the room might be created later by Socket.IO
    }
  }

  const persistenceInterval = setInterval(async () => {
    try {
      if (!documents.has(roomName)) {
        clearInterval(persistenceInterval);
        return;
      }

      const currentTime = Date.now();
      const lastAccessTime = lastAccess.get(roomName);

      if (currentTime - lastAccessTime > CLEANUP_TIMEOUT) {
        clearInterval(persistenceInterval);
        await cleanupDocument(roomName);
      } else {
        await Promise.all([
          persistence.storeUpdate(roomName, Y.encodeStateAsUpdate(ydoc)),
          syncToMongo(roomName, ydoc)
        ]);
      }
    } catch (error) {
      console.error(`Error in persistence interval for room ${roomName}:`, error);
    }
  }, PERSISTENCE_INTERVAL);

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

// Periodic cleanup
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

process.on('SIGINT', async () => {
  try {
    console.log('Gracefully shutting down...');
    const cleanupPromises = Array.from(documents.entries()).map(async ([roomName, doc]) => {
      await cleanupDocument(roomName);
    });
    await Promise.all(cleanupPromises);
    await mongoClient.close();
    process.exit(0);
  } catch (error) {
    console.error('Error during shutdown:', error);
    process.exit(1);
  }
});

startServer();
