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
        // Fetch from MongoDB first
        const mongoDoc = await roomsCollection.findOne({ roomId: roomName });
        const ydoc = new Y.Doc();

        if (mongoDoc?.text) {
            ydoc.getText('shared-text').insert(0, mongoDoc.text);
            console.log(`Loaded content from MongoDB for room: ${roomName}`);
        } else {
            // If no content in MongoDB, fallback to LevelDB
            console.log(`No content in MongoDB for room: ${roomName}, checking LevelDB...`);
            const levelDbDoc = await ldb.getYDoc(roomName);
            const levelDbContent = levelDbDoc.getText('shared-text').toString();
            if (levelDbContent.trim()) {
                ydoc.getText('shared-text').insert(0, levelDbContent);
                console.log(`Loaded content from LevelDB for room: ${roomName}`);
            }
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

// 2. Modify the syncToMongo function to be more selective
async function syncToMongo(roomName, ydoc, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const roomExists = await checkRoomExists(roomName);
      if (!roomExists) {
        console.log(`Room "${roomName}" does not exist in MongoDB; skipping sync`);
        return false;
      }

      const content = ydoc.getText('shared-text').toString();
      if (!content.trim()) return false;

      // Get current MongoDB content
      const currentDoc = await roomsCollection.findOne({ roomId: roomName });
      if (currentDoc?.text === content) {
        console.log(`Content unchanged for "${roomName}", skipping sync`);
        return true;
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
      console.error(`Attempt ${i + 1} to sync "${roomName}" to MongoDB failed:`, err);
      if (i === retries - 1) throw err;
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  return false;
}

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
    }

    const { ydoc, awareness } = docInfo;

conn.on('message', async (message) => {
  try {
    const messageString = typeof message === 'string' ? message : Buffer.from(message).toString();
    const parsedMessage = JSON.parse(messageString);

    console.log('Parsed WebSocket message:', parsedMessage);

    if (parsedMessage.type === 'fetch_content') {
      const { roomId } = parsedMessage.data;

      if (!roomId || typeof roomId !== 'string') {
        const response = { type: 'fetch_content_response', data: { success: false, error: 'Invalid roomId.' } };
        conn.send(JSON.stringify(response));
        return;
      }

      // Retrieve content from MongoDB
      const room = await roomsCollection.findOne({ roomId });
      if (room?.text) {
        const response = { type: 'fetch_content_response', data: { success: true, text: room.text } };
        conn.send(JSON.stringify(response));
      } else {
        const response = { type: 'fetch_content_response', data: { success: false, error: 'No content found for the room.' } };
        conn.send(JSON.stringify(response));
      }
    } else {
      console.warn('Received unexpected message type:', parsedMessage.type);
    }
  } catch (err) {
    console.error('Error handling WebSocket message:', err);
    const errorResponse = { type: 'fetch_content_response', data: { success: false, error: 'Internal Server Error' } };
    conn.send(JSON.stringify(errorResponse));
  }
});



    
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
