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
const allowedFrontendUrls = (
  process.env.FRONTEND_URLS || 'http://localhost:3000,https://www.syncrolly.com,https://syncrolly.vercel.app'
)
  .split(',')
  .map((url) => url.trim());

// Ensure CORS is defined before any routes or middleware
app.use(
  cors({
    origin: function(origin, callback) {
      // Allow requests with no origin (like mobile apps, curl requests)
      if (!origin) return callback(null, true);

      if (allowedFrontendUrls.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        callback(new Error('Not allowed by CORS'));
      }
    },
    methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  }),
);

// Remove the incorrect app.options middleware
// app.options('*', (req, res) => { ... });

// =========================
// ===== Middleware Setup =====
// =========================
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// =========================
// ===== MongoDB Setup =====
// =========================
const MONGO_URI = process.env.MONGO_URI;
const client = new MongoClient(MONGO_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

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
  '.jpeg',
  '.jpg',
  '.png',
  '.pdf',
  '.txt',
  '.html',
  '.js',
  '.css',
  '.zip',
  '.rar',
  '.py',
  '.php',
  '.7z',
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
      cb(
        new Error(
          'Invalid file type. Only images, PDFs, text files, HTML, JS, CSS, Python, PHP, ZIP, RAR, 7z files are allowed.',
        ),
      );
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
    const fileUrl = `${
      process.env.BACKEND_URL || 'http://localhost:4000'
    }/uploads/${file.filename}`;
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
      return res
        .status(400)
        .json({ error: 'This file has already been uploaded.' });
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
    res
      .status(500)
      .json({ error: 'Internal Server Error', details: error.message });
  }
});

// File Deletion Route
app.delete('/delete_file/:roomId/:fileId', async (req, res) => {
  try {
    const { roomId, fileId } = req.params;
    if (!ObjectId.isValid(fileId)) {
      return res.status(400).json({ error: 'Invalid file ID format.' });
    }

    const fileToDelete = await uploadsCollection.findOne({
      roomId,
      _id: new ObjectId(fileId),
    });
    if (!fileToDelete) {
      return res.status(404).json({ error: 'File not found.' });
    }

    const deleteResult = await uploadsCollection.deleteOne({
      _id: new ObjectId(fileId),
    });
    const filePath = path.join(uploadsDir, path.basename(fileToDelete.fileUrl));

    try {
      await fs.promises.unlink(filePath);
      console.log('File deleted from filesystem:', filePath);
    } catch (err) {
      console.error('Failed to delete file from filesystem:', err);
    }

    res.status(200).json({
      success: true,
      message: 'File deleted successfully',
      deletedCount: deleteResult.deletedCount,
    });
  } catch (error) {
    console.error('Error in file deletion:', error);
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
      { upsert: true },
    );
    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error saving room content:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// The function `saveContentToMongo` should store `text` in MongoDB
async function saveContentToMongo(roomId, text) {
  try {
    await roomsCollection.updateOne(
      { roomId },
      {
        $set: {
          text,
          lastActivity: new Date(),
        },
      },
      { upsert: true },
    );
    console.log(`Text saved for room ${roomId} in MongoDB`);
  } catch (error) {
    console.error('Error saving content to MongoDB:', error);
  }
}

// ===========================
// ===== Health Check Route =====
// ===========================
app.get('/health', (req, res) => {
  // Simple health check endpoint for uptime monitors
  res.status(200).send('API OK');
});

// ========================
// ===== Socket.IO Events =====
// ========================
io.on('connection', async (socket) => {
  console.log(`User connected: ${socket.id}`);

  // Add the connected user to MongoDB
  await activeUsersCollection.insertOne({
    socketId: socket.id,
    connectedAt: new Date(),
  });

  // Emit the total connected users count to all clients
  const totalConnectedUsers = await activeUsersCollection.countDocuments();
  io.emit('status_update', { totalConnectedUsers });

  socket.on('save_content', async ({ roomId, text }, callback) => {
    try {
      await roomsCollection.updateOne(
        { roomId },
        {
          $set: {
            text,
            lastActivity: new Date(),
          },
        },
        { upsert: true },
      );
      console.log(
        `Content saved to MongoDB for room ${roomId}:`,
        text.substring(0, 100) + '...',
      );

      if (callback) {
        callback({ success: true });
      }
    } catch (error) {
      console.error('Error saving content to MongoDB:', error);
      if (callback) {
        callback({ success: false, error: error.message });
      }
    }
  });

  // Handle room joining with improved reliability
  socket.on(
    'join_room',
    async ({ roomId, userName, userId, isCreator }, callback) => {
      try {
        console.log(`User ${userName} (${userId}) attempting to join room ${roomId}. isCreator: ${isCreator}`);

        // Retry logic for finding or creating the room
        let room = null;
        let retryCount = 0;
        const maxRetries = 3;

        while (!room && retryCount < maxRetries) {
          try {
            room = await roomsCollection.findOne({ roomId });

            if (!room) {
              if (isCreator) {
                console.log(`Creating new room ${roomId} for creator ${userName} (${userId})`);
                room = {
                  roomId,
                  text: '',
                  messages: [],
                  users: {},
                  theme: 'light',
                  lastActivity: new Date(),
                  creatorId: userId,
                  isEditable: true,
                  editorMode: 'text', // Default editor mode
                  createdAt: new Date(),
                };

                const result = await roomsCollection.insertOne(room);
                if (!result.acknowledged) {
                  throw new Error('Failed to create room in database');
                }

                console.log(`Room ${roomId} created successfully`);
              } else {
                console.log(`Room ${roomId} not found for non-creator ${userName}`);
                return callback({ error: 'Room does not exist.' });
              }
            }
          } catch (err) {
            retryCount++;
            console.error(`Attempt ${retryCount}/${maxRetries} failed to find/create room:`, err);

            if (retryCount >= maxRetries) {
              throw new Error(`Failed to find/create room after ${maxRetries} attempts`);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        // Add user to room
        room.users[userId] = userName;

        // Update room with retry logic
        let updateSuccess = false;
        retryCount = 0;

        while (!updateSuccess && retryCount < maxRetries) {
          try {
            const updateResult = await roomsCollection.updateOne(
              { roomId },
              {
                $set: {
                  users: room.users,
                  lastActivity: new Date(),
                },
              },
            );

            if (updateResult.matchedCount === 0) {
              throw new Error('Room not found during update');
            }

            updateSuccess = true;
            console.log(`User ${userName} added to room ${roomId} successfully`);
          } catch (err) {
            retryCount++;
            console.error(`Attempt ${retryCount}/${maxRetries} failed to update room:`, err);

            if (retryCount >= maxRetries) {
              throw new Error(`Failed to update room after ${maxRetries} attempts`);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        // Join the socket.io room
        socket.join(roomId);
        socketUserMap.set(socket.id, { userId, roomId });

        // Notify other users in the room
        socket.to(roomId).emit('user_joined', {
          userId,
          userName,
          timestamp: new Date().toISOString()
        });

        // Fetch files with retry logic
        let files = [];
        retryCount = 0;

        while (retryCount < maxRetries) {
          try {
            files = await uploadsCollection.find({ roomId }).toArray();
            break;
          } catch (err) {
            retryCount++;
            console.error(`Attempt ${retryCount}/${maxRetries} failed to fetch files:`, err);

            if (retryCount >= maxRetries) {
              console.error('Failed to fetch files, will return empty array');
              files = [];
              break;
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, 1000));
          }
        }

        // Send success response with room data
        callback({
          success: true,
          text: room.text || '', // Include initial text content
          messages: room.messages || [],
          theme: room.theme || 'light',
          files: files,
          users: room.users,
          isCreator: room.creatorId === userId,
          isEditable: room.isEditable !== false, // Default to true if undefined
          editorMode: room.editorMode || 'text',
          roomCreatedAt: room.createdAt,
        });

        console.log(`User ${userName} (${userId}) successfully joined room ${roomId}`);
      } catch (error) {
        console.error('Error in join_room:', error);
        callback({ error: 'Internal Server Error', details: error.message });
      }
    },
  );

  // Handle toggle_editability
  socket.on('toggle_editability', async ({ roomId, userId }, callback) => {
    try {
      const room = await roomsCollection.findOne({ roomId });
      if (!room) {
        return callback({ error: 'Room not found.' });
      }

      if (room.creatorId !== userId) {
        return callback({
          error: 'Only the room creator can toggle editability.',
        });
      }

      const newEditableState = !room.isEditable;
      await roomsCollection.updateOne(
        { roomId },
        { $set: { isEditable: newEditableState } },
      );

      // Notify all clients in the room
      io.to(roomId).emit('editable_state_changed', {
        isEditable: newEditableState,
      });

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
        return callback({
          error: 'Only the room creator can toggle the editor mode.',
        });
      }

      const newEditorMode = room.editorMode === 'code' ? 'text' : 'code';
      await roomsCollection.updateOne(
        { roomId },
        { $set: { editorMode: newEditorMode, lastActivity: new Date() } },
      );

      io.to(roomId).emit('editor_mode_changed', {
        roomId,
        editorMode: newEditorMode,
      });
      console.log(
        `Room ${roomId} editor mode changed to ${newEditorMode} by user ${userId}`,
      );

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
        { $set: { messages: room.messages, lastActivity: new Date() } },
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
        { $set: { theme, lastActivity: new Date() } },
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
          { $set: { users: room.users, lastActivity: new Date() } },
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

    console.log(
      `Running scheduled task to delete inactive rooms. Current time: ${now}`,
    );

    const inactiveRooms = await roomsCollection
      .find({ lastActivity: { $lt: cutoffTime } })
      .toArray();

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
          console.error(
            `Failed to delete file ${filename} from filesystem:`,
            err,
          );
        }
      }

      // Delete files from the database
      const deleteFilesResult = await uploadsCollection.deleteMany({ roomId });
      console.log(
        `Deleted ${deleteFilesResult.deletedCount} file(s) from uploads for room ${roomId}.`,
      );

      // Delete room from database
      const deleteRoomResult = await roomsCollection.deleteOne({ roomId });
      if (deleteRoomResult.deletedCount === 1) {
        console.log(
          `Successfully deleted room ${roomId} from rooms collection.`,
        );
      } else {
        console.warn(
          `Failed to delete room ${roomId} from rooms collection.`,
        );
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
    // Connect to MongoDB with retry mechanism
    let retries = 5;
    let connected = false;

    while (retries > 0 && !connected) {
      try {
        await client.connect();
        connected = true;
        console.log('Connected to MongoDB successfully');
      } catch (err) {
        console.error(`MongoDB connection attempt failed. Retries left: ${retries}`);
        retries--;
        // Wait before retrying (exponential backoff)
        await new Promise(resolve => setTimeout(resolve, 2000 * (5 - retries)));
      }
    }

    if (!connected) {
      throw new Error('Failed to connect to MongoDB after multiple attempts');
    }

    // Set up MongoDB collections
    const db = client.db('syncrolly');
    roomsCollection = db.collection('rooms');
    uploadsCollection = db.collection('uploads');
    activeUsersCollection = db.collection('activeUsers');

    // Add MongoDB connection error handler
    client.on('error', (error) => {
      console.error('MongoDB connection error:', error);
      // Attempt to reconnect
      console.log('Attempting to reconnect to MongoDB...');
      client.connect()
        .then(() => console.log('Reconnected to MongoDB'))
        .catch(err => console.error('Failed to reconnect to MongoDB:', err));
    });

    const PORT = process.env.PORT || 4000;
    server.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running on port ${PORT}`);
      console.log(`Server is ready to accept connections at ${new Date().toISOString()}`);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

// Initialize the application
startServer();
