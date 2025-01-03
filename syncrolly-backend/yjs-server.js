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

// MongoDB connection
const MONGO_URI = process.env.MONGO_URI;
const mongoClient = new MongoClient(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
});
let roomsCollection;

// Port for the Yjs WebSocket server
const PORT = process.env.YJS_PORT || 1234;

// LevelDB for offline Yjs persistence (optional)
const persistenceDir = path.join(__dirname, 'yjs-docs');
if (!fs.existsSync(persistenceDir)) {
  fs.mkdirSync(persistenceDir);
}
const persistence = new LeveldbPersistence(persistenceDir);

// Keep references to each Y.Doc in memory, keyed by roomId
const documents = new Map();

// Create a simple HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Yjs WebSocket Server');
});

// Create the WebSocket server
const wss = new WebSocket.Server({ server });

/**
 * Load existing text from MongoDB for a given roomId into a new Y.Doc
 */
async function loadYDocFromDB(roomId) {
  const ydoc = new Y.Doc();

  const existing = await roomsCollection.findOne({ roomId });
  if (existing?.text) {
    const ytext = ydoc.getText('shared-text');
    ytext.insert(0, existing.text);
    console.log(`Loaded text for room ${roomId} from MongoDB`);
  }

  return ydoc;
}

/**
 * Save the current text from the Y.Doc back to MongoDB
 */
async function saveYDocToDB(roomId, ydoc) {
  try {
    const content = ydoc.getText('shared-text').toString();
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
 * Handle new WebSocket connections from clients
 */
wss.on('connection', async (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomId = parsedUrl.pathname.slice(1).split('?')[0] || 'default-room';

  try {
    // Reuse an in-memory doc if it exists; otherwise load from DB
    let ydoc = documents.get(roomId);
    if (!ydoc) {
      ydoc = await loadYDocFromDB(roomId);
      documents.set(roomId, ydoc);
    }

    // Listen for every local Y.Doc update (keystroke)
    ydoc.on('update', (update) => {
      console.log(`DOC UPDATED for room ${roomId} - update length: ${update.byteLength}`);
      // Save to DB on every single update
      saveYDocToDB(roomId, ydoc);
    });

    // If you want an interval fallback, you could add one:
    // const saveInterval = setInterval(() => saveYDocToDB(roomId, ydoc), 5000);

    // Setup standard Yjs WebSocket
    setupWSConnection(conn, req, {
      docName: roomId,
      gc: true,
      gcFilter: () => false
    });

    // On connection close, do a final save
    conn.on('close', async () => {
      // clearInterval(saveInterval); // if you set it
      if (documents.has(roomId)) {
        await saveYDocToDB(roomId, ydoc);
        console.log(`Connection closed for room ${roomId}, final save done.`);
      }
    });
  } catch (error) {
    console.error(`Error in WebSocket connection for room ${roomId}:`, error);
  }
});

// Start the server + connect to MongoDB
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
