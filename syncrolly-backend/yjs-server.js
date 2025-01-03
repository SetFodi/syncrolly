// yjs-server.js

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

// MongoDB
const MONGO_URI = process.env.MONGO_URI;
const mongoClient = new MongoClient(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
let roomsCollection;

// Yjs WebSocket server port
const PORT = process.env.YJS_PORT || 1234;

// LevelDB for Yjs offline persistence (optional)
const persistenceDir = path.join(__dirname, 'yjs-docs');
if (!fs.existsSync(persistenceDir)) {
  fs.mkdirSync(persistenceDir);
}
const persistence = new LeveldbPersistence(persistenceDir);

// Keep references to each Y.Doc in memory
const documents = new Map();

// Create HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Yjs WebSocket Server');
});

// Create WebSocket server
const wss = new WebSocket.Server({ server });

/**
 * Load doc text from MongoDB into a fresh Y.Doc, if any.
 */
async function loadYDocFromDB(roomId) {
  let ydoc = new Y.Doc();

  const existing = await roomsCollection.findOne({ roomId });
  if (existing?.text) {
    const ytext = ydoc.getText('shared-text');
    ytext.insert(0, existing.text);
    console.log(`Loaded text for room ${roomId} from MongoDB`);
  }

  return ydoc;
}

/**
 * Save the Y.Doc’s current text back to MongoDB
 */
async function saveYDocToDB(roomId, ydoc) {
  try {
    const content = ydoc.getText('shared-text').toString();
    // If you want to avoid empty saves, check trim() if you like
    await roomsCollection.updateOne(
      { roomId },
      {
        $set: {
          text: content,
          lastActivity: new Date()
        }
      },
      { upsert: true }
    );
    console.log(`Saved room ${roomId} doc to MongoDB`);
  } catch (err) {
    console.error(`Error saving Y.Doc for room ${roomId} to DB:`, err);
  }
}

/**
 * Handle new WebSocket connections
 */
wss.on('connection', async (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomId = parsedUrl.pathname.slice(1).split('?')[0];

  try {
    // If we already have a doc in memory, reuse it; otherwise load from DB
    let ydoc = documents.get(roomId);
    if (!ydoc) {
      ydoc = await loadYDocFromDB(roomId);
      documents.set(roomId, ydoc);
    }

    // Setup standard Yjs websocket connection
    setupWSConnection(conn, req, {
      docName: roomId,
      gc: true,
      gcFilter: () => false
    });

    // Auto-save every 5 seconds
    const saveInterval = setInterval(async () => {
      await saveYDocToDB(roomId, ydoc);
    }, 5000);

    // Final save on close
    conn.on('close', async () => {
      clearInterval(saveInterval);
      if (documents.has(roomId)) {
        await saveYDocToDB(roomId, ydoc);
        console.log(`Connection closed for room ${roomId}, final save done.`);
      }
    });
  } catch (error) {
    console.error(`Error in wss connection for room ${roomId}:`, error);
  }
});

// Start server + DB
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
    console.error('Failed to start Yjs server:', error);
    process.exit(1);
  }
}

startServer();
