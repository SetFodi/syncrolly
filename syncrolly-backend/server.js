/*******************************************************
 * server.js
 * Main Express + Socket.IO server
 *******************************************************/

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const cron = require('node-cron');
const dotenv = require('dotenv');
const { MongoClient, ObjectId } = require('mongodb');

dotenv.config();

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: (process.env.FRONTEND_URLS || 'http://localhost:3000').split(','),
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    credentials: true
  }
});

// --------------
// MongoDB Setup
// --------------
const MONGO_URI = process.env.MONGO_URI;
const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

let roomsCollection;
let uploadsCollection;
let activeUsersCollection;

// --------------
// CORS Setup
// --------------
const allowedFrontendUrls = (process.env.FRONTEND_URLS || 'http://localhost:3000').split(',');
app.use(cors({
  origin: allowedFrontendUrls,
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
}));
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', allowedFrontendUrls.join(','));
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// --------------
// Middleware
// --------------
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Ensure 'uploads' directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// --------------
// Multer Setup
// --------------
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  }
});
const allowedExtensions = [
  '.jpeg', '.jpg', '.png', '.pdf', '.txt', '.html', '.js', '.css',
  '.zip', '.rar', '.py', '.php', '.7z'
];
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowedExtensions.includes(ext)) cb(null, true);
    else cb(new Error(`Invalid file type: ${ext}`));
  }
});

// --------------
// File Routes
// --------------
app.post('/upload/:roomId', upload.single('file'), async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file uploaded.' });

    const fileUrl = `${process.env.BACKEND_URL || 'http://localhost:4000'}/uploads/${file.filename}`;
    const room = await roomsCollection.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }
    const userName = room.users[userId];
    if (!userName) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }
    const existingFile = await uploadsCollection.findOne({ roomId, fileUrl });
    if (existingFile) {
      return res.status(400).json({ error: 'File already uploaded.' });
    }
    const newFile = {
      roomId,
      fileName: file.originalname,
      fileUrl,
      uploadedBy: userName,
      uploadedAt: new Date()
    };
    await uploadsCollection.insertOne(newFile);
    io.to(roomId).emit('new_file', newFile);
    res.status(200).json(newFile);
  } catch (error) {
    console.error('Error in file upload:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

app.delete('/delete_file/:roomId/:fileId', async (req, res) => {
  try {
    const { roomId, fileId } = req.params;
    if (!ObjectId.isValid(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID format.' });
    }
    const fileToDelete = await uploadsCollection.findOne({ roomId, _id: new ObjectId(fileId) });
    if (!fileToDelete) {
      return res.status(404).json({ error: 'File not found.' });
    }
    const deleteResult = await uploadsCollection.deleteOne({ _id: new ObjectId(fileId) });
    const filePath = path.join(uploadsDir, path.basename(fileToDelete.fileUrl));
    try {
      await fs.promises.unlink(filePath);
    } catch (err) {
      console.error('Failed to delete file from filesystem:', err);
    }
    res.status(200).json({
      success: true,
      message: 'File deleted successfully',
      deletedCount: deleteResult.deletedCount
    });
  } catch (error) {
    console.error('Error in file deletion:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// --------------
// Socket.IO Logic
// --------------
io.on('connection', async (socket) => {
  console.log(`User connected: ${socket.id}`);
  await activeUsersCollection.insertOne({ socketId: socket.id, connectedAt: new Date() });
  const totalConnectedUsers = await activeUsersCollection.countDocuments();
  io.emit('status_update', { totalConnectedUsers });

  // Room join
  socket.on('join_room', async ({ roomId, userName, userId, isCreator }, callback) => {
    try {
      let room = await roomsCollection.findOne({ roomId });
      if (!room) {
        if (isCreator) {
          // Create new room
          room = {
            roomId,
            text: '',
            messages: [],
            users: {},
            theme: 'light',
            lastActivity: new Date(),
            creatorId: userId,
            isEditable: true
          };
          await roomsCollection.insertOne(room);
        } else {
          return callback({ error: 'Room does not exist.' });
        }
      }
      // Add user
      room.users[userId] = userName;
      await roomsCollection.updateOne(
        { roomId },
        {
          $set: {
            users: room.users,
            lastActivity: new Date()
          }
        }
      );
      socket.join(roomId);
      // Map socket
      socketUserMap.set(socket.id, { userId, roomId });

      // Return full room data
      const files = await uploadsCollection.find({ roomId }).toArray();
      callback({
        success: true,
        text: room.text || '',
        messages: room.messages,
        theme: room.theme,
        files,
        users: room.users,
        isCreator: (room.creatorId === userId),
        isEditable: room.isEditable
      });
    } catch (error) {
      console.error('Error in join_room:', error);
      callback({ error: 'Internal Server Error' });
    }
  });

  // Chat, typing, messages
  socket.on('send_message', async ({ roomId, userId, message }) => {
    try {
      const room = await roomsCollection.findOne({ roomId });
      if (!room) return;
      const userName = room.users[userId];
      if (!userName) return;

      const fullMessage = { userName, text: message };
      room.messages.push(fullMessage);
      await roomsCollection.updateOne(
        { roomId },
        { $set: { messages: room.messages, lastActivity: new Date() } }
      );
      io.to(roomId).emit('receive_message', fullMessage);
    } catch (error) {
      console.error('Error in send_message:', error);
    }
  });

  socket.on('typing_start', ({ roomId, userId, userName }) => {
    socket.to(roomId).emit('user_typing', { userId, userName });
  });
  socket.on('typing_stop', ({ roomId, userId }) => {
    socket.to(roomId).emit('user_stopped_typing', { userId });
  });

  // Toggle editability
  socket.on('toggle_editability', async ({ roomId, userId }, callback) => {
    try {
      const room = await roomsCollection.findOne({ roomId });
      if (!room) return callback({ error: 'Room not found.' });
      if (room.creatorId !== userId) {
        return callback({ error: 'Only the creator can toggle editability.' });
      }
      const newState = !room.isEditable;
      await roomsCollection.updateOne(
        { roomId },
        { $set: { isEditable: newState, lastActivity: new Date() } }
      );
      io.to(roomId).emit('editable_state_changed', { isEditable: newState });
      callback({ success: true, isEditable: newState });
    } catch (error) {
      console.error('Error in toggle_editability:', error);
      callback({ error: 'Internal error' });
    }
  });

  // Editor mode, theme, etc. can be toggled similarly

  // Disconnect
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id}`);
    const info = socketUserMap.get(socket.id);
    if (info) {
      const { roomId, userId } = info;
      const room = await roomsCollection.findOne({ roomId });
      if (room) {
        delete room.users[userId];
        await roomsCollection.updateOne(
          { roomId },
          { $set: { users: room.users, lastActivity: new Date() } }
        );
        io.emit('room_users', { roomId, users: room.users });
      }
      socketUserMap.delete(socket.id);
    }
    await activeUsersCollection.deleteOne({ socketId: socket.id });
    const total = await activeUsersCollection.countDocuments();
    io.emit('status_update', { totalConnectedUsers: total });
  });
});

// --------------
// Cleanup Task
// --------------
cron.schedule('0 * * * *', async () => {
  // Runs every hour, for instance
  try {
    const now = new Date();
    const cutoff = new Date(now.getTime() - 72 * 60 * 60 * 1000);
    const staleRooms = await roomsCollection.find({ lastActivity: { $lt: cutoff } }).toArray();
    if (!staleRooms.length) {
      console.log('No inactive rooms found this hour.');
      return;
    }
    console.log(`Found ${staleRooms.length} inactive rooms, deleting now...`);
    for (const room of staleRooms) {
      const { roomId } = room;

      // Delete associated files
      const fileList = await uploadsCollection.find({ roomId }).toArray();
      for (const f of fileList) {
        const filePath = path.join(uploadsDir, path.basename(f.fileUrl));
        try {
          await fs.promises.unlink(filePath);
        } catch (err) {
          console.error(`Failed to delete file ${filePath}:`, err);
        }
      }
      await uploadsCollection.deleteMany({ roomId });

      // Actually remove from rooms
      await roomsCollection.deleteOne({ roomId });

      // *** Also ask Yjs server to remove doc from memory & LevelDB ***
      // You have two ways:
      // 1) If yjs-server is in same codebase, require it and call a function
      // 2) Or do an HTTP request or RPC to yjs-server so it calls persistence.clearDocument(roomId)
      // Example if in same monorepo:
      try {
        await removeYjsDoc(roomId); // We'll define this function next
      } catch (err) {
        console.error(`Could not remove doc ${roomId} from Yjs server:`, err);
      }

      // Notify any connected clients
      io.to(roomId).emit('room_deleted', {
        message: 'This room has been deleted due to 72-hour inactivity.',
        deleteAfter: new Date()
      });
      console.log(`Successfully deleted inactive room ${roomId}.`);
    }
  } catch (error) {
    console.error('Error in cleanup:', error);
  }
});

async function removeYjsDoc(roomId) {
  // We'll define a function that your yjs-server exports or you can do an HTTP request there
  // If they're separate services, you might do:
  //   await fetch('https://your-yjs-server.com/remove_doc?roomId=' + roomId);
  // That route would do memory+LevelDB cleanup.

  // For simplicity, if yjs-server is in same codebase,
  // you can import { documents, persistence } from './yjs-server' (but keep an eye on circular imports).
  // Then:
  // documents.delete(roomId);
  // await persistence.clearDocument(roomId);
  // console.log(`removeYjsDoc: removed doc ${roomId} from memory + LevelDB`);
}

// --------------
// Start Server
// --------------
const socketUserMap = new Map(); // stores { socketId => { userId, roomId } }

async function startServer() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');

    const db = client.db('syncrolly');
    roomsCollection = db.collection('rooms');
    uploadsCollection = db.collection('uploads');
    activeUsersCollection = db.collection('activeUsers');

    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => {
      console.log(`Main server listening on port ${PORT}`);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}
startServer();
