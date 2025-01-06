/************************************************************
 * server.js (ES Module style, keep .js extension)
 * 
 * Because package.json has "type": "module", 
 * Node will interpret this as an ES module.
 *************************************************************/

import express from 'express';
import http from 'http';
import { Server } from 'socket.io';
import multer from 'multer';
import path from 'path';
import { MongoClient, ObjectId } from 'mongodb';
import fs from 'fs';
import cors from 'cors';
import cron from 'node-cron';
import dotenv from 'dotenv';
import _ from 'lodash';

// For __dirname in ES modules:
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

// Create Express app & HTTP server
const app = express();
const server = http.createServer(app);

// =====================
// ===== CORS Setup =====
// =====================
const allowedFrontendUrls = (process.env.FRONTEND_URLS || 'http://localhost:3000,https://www.syncrolly.com')
  .split(',')
  .map(url => url.trim());

// Ensure CORS is defined before any routes or middleware
app.use(cors({
  origin: allowedFrontendUrls, // Allow specific frontend URLs
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'], // Ensure OPTIONS is included
  allowedHeaders: ['Content-Type', 'Authorization'], // Specify allowed headers
  credentials: true, // Allow credentials if needed
}));

// Preflight handling (applicable for DELETE and POST requests)
app.options('*', (req, res) => {
  res.header('Access-Control-Allow-Origin', allowedFrontendUrls.join(',')); 
  res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');
  res.sendStatus(200);
});

// =========================
// ===== Middleware Setup =====
// =========================
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// =========================
// ===== MongoDB Setup =====
// =========================
const MONGO_URI = process.env.MONGO_URI;
const client = new MongoClient(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true });

let roomsCollection;
let uploadsCollection;
let activeUsersCollection;

// Ensure 'uploads' directory exists
const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir);
}

// Set up file storage using multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const allowedExtensions = [
  '.jpeg', '.jpg', '.png', '.pdf', '.txt', '.html', '.js', '.css',
  '.zip', '.rar', '.py', '.php', '.7z'
];

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    console.log('File extension:', ext); // Log extension for debugging

    if (allowedExtensions.includes(ext)) {
      cb(null, true); // Extension allowed
    } else {
      cb(new Error('Invalid file type. Only images, PDFs, text files, HTML, JS, CSS, Python, PHP, ZIP, RAR, 7z files are allowed.'));
    }
  },
});

// ============================
// ===== Socket.IO Setup =====
// ============================
const io = new Server(server, {
  cors: {
    origin: allowedFrontendUrls,
    methods: ['GET', 'POST'],
  },
});

// A map to store socket.id => { userId, roomId }
const socketUserMap = new Map();

// =======================
// ===== File Routes =====
// =======================

// File Upload Route
app.post('/upload/:roomId', upload.single('file'), async (req, res) => {
  try {
    const { roomId } = req.params;
    const { userId } = req.body;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded.' });
    }

    console.log(`File uploaded: ${file.originalname}`);
    const fileUrl = `${process.env.BACKEND_URL || 'http://localhost:4000'}/uploads/${file.filename}`;
    console.log(`File URL: ${fileUrl}`);

    const room = await roomsCollection.findOne({ roomId });
    if (!room) {
      return res.status(404).json({ error: 'Room not found.' });
    }

    const userName = room.users[userId];
    if (!userName) {
      return res.status(400).json({ error: 'Invalid user ID.' });
    }

    // Check if file already exists in the database
    const existingFile = await uploadsCollection.findOne({ roomId, fileUrl });
    if (existingFile) {
      return res.status(400).json({ error: 'This file has already been uploaded.' });
    }

    const newFile = {
      roomId,
      fileName: file.originalname,
      fileUrl,
      uploadedBy: userName,
      uploadedAt: new Date(),
    };

    await uploadsCollection.insertOne(newFile);

    // Emit event to notify the room about the new file
    io.to(roomId).emit('new_file', newFile);

    console.log('New file uploaded:', newFile);
    console.log(`Uploading to: ${fileUrl}`);

    res.status(200).json(newFile);
  } catch (error) {
    console.error('Error in file upload:', error);
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});

// File Deletion Route
app.delete('/delete_file/:roomId/:fileId', async (req, res) => {
  try {
    const { roomId, fileId } = req.params;

    if (!ObjectId.isValid(fileId)) {
      res.setHeader('Access-Control-Allow-Origin', allowedFrontendUrls.join(','));
      return res.status(400).json({ error: 'Invalid file ID format.' });
    }

    const fileToDelete = await uploadsCollection.findOne({ roomId, _id: new ObjectId(fileId) });
    if (!fileToDelete) {
      res.setHeader('Access-Control-Allow-Origin', allowedFrontendUrls.join(','));
      return res.status(404).json({ error: 'File not found.' });
    }

    const deleteResult = await uploadsCollection.deleteOne({ _id: new ObjectId(fileId) });
    const filePath = path.join(uploadsDir, path.basename(fileToDelete.fileUrl));

    try {
      await fs.promises.unlink(filePath);
      console.log('File deleted from filesystem:', filePath);
    } catch (err) {
      console.error('Failed to delete file from filesystem:', err);
    }

    res.setHeader('Access-Control-Allow-Origin', allowedFrontendUrls.join(','));
    res.status(200).json({
      success: true,
      message: 'File deleted successfully',
      deletedCount: deleteResult.deletedCount,
    });
  } catch (error) {
    console.error('Error in file deletion:', error);
    res.setHeader('Access-Control-Allow-Origin', allowedFrontendUrls.join(','));
    res.status(500).json({ error: 'Internal Server Error', details: error.message });
  }
});
app.get('/room/:roomId/content', async (req, res) => {
  try {
    const room = await roomsCollection.findOne({ roomId: req.params.roomId });
    if (!room) return res.status(404).json({ error: 'Room not found' });
    res.json({ text: room.text || '' });
  } catch (error) {
    console.error('Error fetching room content:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});
app.post('/room/:roomId/content', async (req, res) => {
  try {
    const { text } = req.body;
    await roomsCollection.updateOne(
      { roomId: req.params.roomId },
      { $set: { text, lastActivity: new Date() } },
      { upsert: true }
    );
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error saving room content:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// The function `saveContentToMongo` should store `text` in MongoDB
// Replace your existing saveContentToMongo function with this
async function saveContentToMongo(roomId, text) {
  try {
    console.log(`[saveContentToMongo] Attempting to save content for room ${roomId}, length: ${text?.length || 0}`);
    
    // First verify the room exists
    const room = await roomsCollection.findOne({ roomId });
    if (!room) {
      console.error(`[saveContentToMongo] No room found with ID ${roomId}`);
      return false;
    }

    const result = await roomsCollection.updateOne(
      { roomId },
      { 
        $set: { 
          text,
          lastActivity: new Date(),
        }
      },
      { upsert: false }
    );

    if (result.matchedCount === 0) {
      console.error(`[saveContentToMongo] No document matched for room ${roomId}`);
      return false;
    }

    // Verify the update
    const verifyDoc = await roomsCollection.findOne({ roomId });
    console.log(`[saveContentToMongo] Verification - Room ${roomId} text length: ${verifyDoc?.text?.length || 0}`);
    
    return true;
  } catch (error) {
    console.error('[saveContentToMongo] Error saving content:', error);
    return false;
  }
}

// ========================
// ===== Socket.IO Events =====
// ========================
io.on('connection', async (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Add the connected user to MongoDB
  await activeUsersCollection.insertOne({
    socketId: socket.id,
    connectedAt: new Date()
  });

  // Emit the total connected users count to all clients
  const totalConnectedUsers = await activeUsersCollection.countDocuments();
  io.emit('status_update', { totalConnectedUsers });

 socket.on('save_content', async ({ roomId, text }, callback) => {
  try {
    console.log(`Attempting to save content for room ${roomId}, content length: ${text?.length || 0}`);
    console.log('Content preview:', text?.substring(0, 100));

    // First verify the room exists
    const room = await roomsCollection.findOne({ roomId });
    if (!room) {
      console.error(`No room found with ID ${roomId}`);
      if (callback) callback({ success: false, error: 'Room not found' });
      return;
    }

    const result = await roomsCollection.updateOne(
      { roomId },
      { 
        $set: {
          text,
          lastActivity: new Date()
        }
      },
      { upsert: false } // Don't create new rooms, only update existing ones
    );

    if (result.matchedCount === 0) {
      console.error(`No document matched for room ${roomId}`);
      if (callback) callback({ success: false, error: 'Room not found' });
      return;
    }

    if (result.modifiedCount === 0) {
      console.log(`No changes made to room ${roomId} (content might be the same)`);
    } else {
      console.log(`Content updated for room ${roomId}. ModifiedCount: ${result.modifiedCount}`);
    }

    // Verify the update
    const verifyDoc = await roomsCollection.findOne({ roomId });
    console.log(`Verification - Room ${roomId} text length in MongoDB: ${verifyDoc?.text?.length || 0}`);
    
    if (callback) {
      callback({ 
        success: true,
        contentLength: verifyDoc?.text?.length || 0
      });
    }
  } catch (error) {
    console.error('Error saving content to MongoDB:', error);
    if (callback) {
      callback({ success: false, error: error.message });
    }
  }
});

  // Handle room joining
socket.on('join_room', async ({ roomId, userName, userId, isCreator }, callback) => {
    try {
        let room = await roomsCollection.findOne({ roomId });

        if (!room) {
            if (isCreator) {
                // Create room document first
                room = {
                    roomId,
                    text: '', // Initialize with empty text
                    messages: [],
                    users: { [userId]: userName }, // Initialize with the creator
                    theme: 'light',
                    lastActivity: new Date(),
                    creatorId: userId,
                    isEditable: true,
                };

                // Insert the room first
                const result = await roomsCollection.insertOne(room);
                
                if (!result.insertedId) {
                    throw new Error('Failed to create room');
                }

                console.log(`Created new room "${roomId}" with creator "${userName}"`);
            } else {
                return callback({ error: 'Room does not exist.' });
            }
        } else {
            // Update existing room's users
            room.users[userId] = userName;
            await roomsCollection.updateOne(
                { roomId },
                {
                    $set: {
                        users: room.users,
                        lastActivity: new Date(),
                    }
                }
            );
        }

        socket.join(roomId);
        socketUserMap.set(socket.id, { userId, roomId });

        // Get fresh room data
        const updatedRoom = await roomsCollection.findOne({ roomId });
        if (!updatedRoom) {
            throw new Error('Room not found after creation/update');
        }

        callback({
            success: true,
            text: updatedRoom.text || '',
            messages: updatedRoom.messages || [],
            theme: updatedRoom.theme || 'light',
            files: await uploadsCollection.find({ roomId }).toArray(),
            users: updatedRoom.users,
            isCreator: updatedRoom.creatorId === userId,
            isEditable: updatedRoom.isEditable,
        });

        console.log(`User "${userName}" joined room "${roomId}"`);
    } catch (error) {
        console.error('Error in join_room:', error);
        callback({ error: 'Internal Server Error: ' + error.message });
    }
});

  // Handle toggle_editability
  socket.on('toggle_editability', async ({ roomId, userId }, callback) => {
    try {
      const room = await roomsCollection.findOne({ roomId });
      if (!room) {
        return callback({ error: 'Room not found.' });
      }

      if (room.creatorId !== userId) {
        return callback({ error: 'Only the room creator can toggle editability.' });
      }

      const newEditableState = !room.isEditable;
      await roomsCollection.updateOne(
        { roomId },
        { $set: { isEditable: newEditableState } }
      );

      // Notify all clients in the room
      io.to(roomId).emit('editable_state_changed', { isEditable: newEditableState });

      callback({ success: true, isEditable: newEditableState });
    } catch (error) {
      console.error('Error in toggle_editability:', error);
      if (callback) {
        callback({ error: 'Internal Server Error' });
      }
    }
  });

  // Handle toggle_editor_mode
  socket.on('toggle_editor_mode', async ({ roomId, userId }, callback) => {
    try {
      const room = await roomsCollection.findOne({ roomId });
      if (!room) {
        return callback({ error: 'Room not found.' });
      }

      if (room.creatorId !== userId) {
        return callback({ error: 'Only the room creator can toggle the editor mode.' });
      }

      const newEditorMode = (room.editorMode === 'code') ? 'text' : 'code';
      await roomsCollection.updateOne(
        { roomId },
        { $set: { editorMode: newEditorMode, lastActivity: new Date() } }
      );

      io.to(roomId).emit('editor_mode_changed', { roomId, editorMode: newEditorMode });
      console.log(`Room ${roomId} editor mode changed to ${newEditorMode} by user ${userId}`);

      if (callback) {
        callback({ success: true, editorMode: newEditorMode });
      }
    } catch (error) {
      console.error('Error in toggle_editor_mode:', error);
      if (callback) {
        callback({ error: 'Internal Server Error' });
      }
    }
  });

  // Handle chat messages
  socket.on('send_message', async ({ roomId, userId, message }) => {
    try {
      const room = await roomsCollection.findOne({ roomId });
      if (!room) return;

      const name = room.users[userId];
      if (!name) return;

      const fullMessage = { userName: name, text: message };
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

  // Handle typing indicators
  socket.on('typing_start', ({ roomId, userId, userName }) => {
    socket.to(roomId).emit('user_typing', { userId, userName });
  });

  socket.on('typing_stop', ({ roomId, userId }) => {
    socket.to(roomId).emit('user_stopped_typing', { userId });
  });

  // Handle theme changes
  socket.on('change_theme', async ({ roomId, theme }) => {
    try {
      await roomsCollection.updateOne(
        { roomId },
        { $set: { theme, lastActivity: new Date() } }
      );
      io.to(roomId).emit('theme_changed', theme);
    } catch (error) {
      console.error('Error in change_theme:', error);
    }
  });

  // Modify the disconnect handler to remove room.text handling
  socket.on('disconnect', async () => {
    console.log(`User disconnected: ${socket.id}`);

    const userInfo = socketUserMap.get(socket.id);
    if (userInfo) {
      const { roomId, userId } = userInfo;

      const room = await roomsCollection.findOne({ roomId });
      if (room) {
        delete room.users[userId];

        // Only update users and lastActivity (no text changes)
        await roomsCollection.updateOne(
          { roomId },
          { $set: { users: room.users, lastActivity: new Date() } }
        );

        io.emit('room_users', { roomId, users: room.users });
      }

      socketUserMap.delete(socket.id);
    }

    await activeUsersCollection.deleteOne({ socketId: socket.id });
    const newTotalUsers = await activeUsersCollection.countDocuments();
    io.emit('status_update', { totalConnectedUsers: newTotalUsers });
  });
});

// ================================
// ===== Scheduled Cleanup Task =====
// ================================
cron.schedule('0 * * * *', async () => {
  try {
    const now = new Date();
    const cutoffTime = new Date(now.getTime() - 72 * 60 * 60 * 1000);

    console.log(`Running scheduled task to delete inactive rooms. Current time: ${now}`);

    const inactiveRooms = await roomsCollection.find({ lastActivity: { $lt: cutoffTime } }).toArray();

    if (inactiveRooms.length === 0) {
      console.log('No inactive rooms found.');
      return;
    }

    console.log(`Found ${inactiveRooms.length} inactive room(s). Deleting...`);

    for (const room of inactiveRooms) {
      const { roomId } = room;

      const associatedFiles = await uploadsCollection.find({ roomId }).toArray();
      for (const file of associatedFiles) {
        const filename = path.basename(file.fileUrl);
        const filePath = path.join(uploadsDir, filename);

        try {
          await fs.promises.unlink(filePath);
          console.log(`Deleted file ${filename} from filesystem.`);
        } catch (err) {
          console.error(`Failed to delete file ${filename} from filesystem:`, err);
        }
      }

      // Delete files from the database
      const deleteFilesResult = await uploadsCollection.deleteMany({ roomId });
      console.log(`Deleted ${deleteFilesResult.deletedCount} file(s) from uploads for room ${roomId}.`);

      // Delete room from database
      const deleteRoomResult = await roomsCollection.deleteOne({ roomId });
      if (deleteRoomResult.deletedCount === 1) {
        console.log(`Successfully deleted room ${roomId} from rooms collection.`);
      } else {
        console.warn(`Failed to delete room ${roomId} from rooms collection.`);
      }

      // Emit a deletion event (if any users are still connected)
      io.to(roomId).emit('room_deleted', {
        message: 'This room has been deleted due to inactivity.',
        deleteAfter: new Date(),
      });
    }
  } catch (error) {
    console.error('Error during scheduled room deletion:', error);
  }
});

// ===============================
// ===== Start the Server ========
// ===============================
async function startServer() {
  try {
    // Connect to MongoDB
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db('syncrolly');
    roomsCollection = db.collection('rooms');
    uploadsCollection = db.collection('uploads');
    activeUsersCollection = db.collection('activeUsers');

    const PORT = process.env.PORT || 4000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

// Initialize the application
startServer();
