const http = require('http');
const WebSocket = require('ws');
const { setupWSConnection } = require('y-websocket/bin/utils.js');
const { LeveldbPersistence } = require('y-leveldb');
const dotenv = require('dotenv');
const url = require('url');
const Y = require('yjs');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb'); // Add MongoDB client

dotenv.config();

// MongoDB setup
const MONGO_URI = process.env.MONGO_URI;
const mongoClient = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });
let roomsCollection;

// Define the port for the Yjs WebSocket server
const PORT = process.env.YJS_PORT || 1234;

// Define the persistence directory
const persistenceDir = path.join(__dirname, 'yjs-docs');
if (!fs.existsSync(persistenceDir)) {
  fs.mkdirSync(persistenceDir);
}

// Initialize LevelDB Persistence
const persistence = new LeveldbPersistence(persistenceDir);
const PERSISTENCE_INTERVAL = 5000;
const documents = new Map();

// Create an HTTP server
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('Yjs WebSocket Server');
});

// Initialize the WebSocket server instance
const wss = new WebSocket.Server({ server });

// Function to sync content to MongoDB
async function syncToMongo(roomName, ydoc) {
  try {
    if (!roomsCollection) return;
    
    const content = ydoc.getText('shared-text').toString();
    await roomsCollection.updateOne(
      { roomId: roomName },
      { 
        $set: { 
          text: content,
          lastActivity: new Date()
        }
      },
      { upsert: true }
    );
    console.log(`Synced document ${roomName} to MongoDB`);
  } catch (error) {
    console.error(`Error syncing to MongoDB for room ${roomName}:`, error);
  }
}

// Handle WebSocket connections

wss.on('connection', async (conn, req) => {
  const parsedUrl = url.parse(req.url, true);
  const roomName = parsedUrl.pathname.slice(1).split('?')[0];

  try {
    const mongoDoc = await roomsCollection.findOne({ roomId: roomName });
    let ydoc = new Y.Doc();
    
    if (mongoDoc?.text) {
      const ytext = ydoc.getText('shared-text');
      ytext.delete(0, ytext.length);
      ytext.insert(0, mongoDoc.text);
      console.log(`Loaded document ${roomName} from MongoDB`);
    }
    
    documents.set(roomName, ydoc);

    // Set up automatic saving
    const saveInterval = setInterval(async () => {
      try {
        const content = ydoc.getText('shared-text').toString();
        if (content.trim()) {
          await roomsCollection.updateOne(
            { roomId: roomName },
            { 
              $set: { 
                text: content,
                lastActivity: new Date()
              }
            },
            { upsert: true }
          );
          console.log(`Auto-saved document ${roomName}`);
        }
      } catch (error) {
        console.error(`Error in auto-save for room ${roomName}:`, error);
      }
    }, 5000);

    conn.on('close', async () => {
      clearInterval(saveInterval);
      if (documents.has(roomName)) {
        const finalContent = ydoc.getText('shared-text').toString();
        if (finalContent.trim()) {
          await roomsCollection.updateOne(
            { roomId: roomName },
            { 
              $set: { 
                text: finalContent,
                lastActivity: new Date()
              }
            },
            { upsert: true }
          );
          console.log(`Final save for room ${roomName}`);
        }
      }
    });

    setupWSConnection(conn, req, {
      docName: roomName,
      gc: true,
      gcFilter: () => false
    });
  } catch (error) {
    console.error(`Error in WebSocket connection for room ${roomName}:`, error);
  }
});

// Start the server
async function startServer() {
  try {
    // Connect to MongoDB first
    await mongoClient.connect();
    console.log('Connected to MongoDB');
    const db = mongoClient.db('syncrolly');
    roomsCollection = db.collection('rooms');

    // Then start the server
    server.listen(PORT, () => {
      console.log(`Yjs WebSocket server running on ws://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
