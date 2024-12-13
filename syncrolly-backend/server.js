// server.js

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const { MongoClient, ObjectId } = require('mongodb');
const fs = require('fs');
const cors = require('cors');
const cron = require('node-cron');
require('dotenv').config();

const app = express();
const server = http.createServer(app);

// Set up CORS
const allowedFrontendUrl = (process.env.FRONTEND_URLS || 'http://localhost:3000')
  .split(',')
  .map(url => url.trim());

app.use(cors({
  origin: allowedFrontendUrl,
  methods: ['GET', 'POST'],
}));

app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// MongoDB setup
const MONGO_URI = process.env.MONGO_URI;
const client = new MongoClient(MONGO_URI);

let roomsCollection;
let uploadsCollection;

// Ensure 'uploads' directory exists
if (!fs.existsSync(path.join(__dirname, 'uploads'))) {
  fs.mkdirSync(path.join(__dirname, 'uploads'));
}

// Set up file storage using multer
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, 'uploads/');
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});
const allowedExtensions = [
  '.jpeg', '.jpg', '.png', '.pdf', '.txt', '.html', '.js', '.css', '.zip', '.rar', '.py', '.php', '.7z'
];

const upload = multer({
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    console.log('File extension:', ext); // Log the file extension for debugging

    if (allowedExtensions.includes(ext)) {
      cb(null, true); // File extension is allowed
    } else {
      cb(new Error('Invalid file type. Only images, PDFs, text files, HTML, JS, CSS, Python, PHP, ZIP, RAR, 7z files are allowed.'));
    }
  },
});

async function startServer() {
  try {
    await client.connect();
    console.log('Connected to MongoDB');
    const db = client.db('syncrolly');
    roomsCollection = db.collection('rooms');
    uploadsCollection = db.collection('uploads');

    const io = new Server(server, {
      cors: {
        origin: allowedFrontendUrl,
        methods: ['GET', 'POST'],
      },
    });

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

        // Validate ObjectId
        if (!ObjectId.isValid(fileId)) {
          return res.status(400).json({ error: 'Invalid file ID format.' });
        }

        // Find the file in the database by the _id (MongoDB's default identifier)
        const fileToDelete = await uploadsCollection.findOne({
          roomId,
          _id: new ObjectId(fileId)
        });

        if (!fileToDelete) {
          return res.status(404).json({ error: 'File not found.' });
        }

        // Delete the file document from the database
        const deleteResult = await uploadsCollection.deleteOne({ _id: new ObjectId(fileId) });

        // Log deletion result for debugging
        console.log('Delete result:', deleteResult);

        // If the file is stored locally, delete the actual file from the file system
        const filePath = path.join(__dirname, 'uploads', fileToDelete.fileUrl.split('/').pop());
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error('Failed to delete file from filesystem:', err);
            // Note: We're not stopping the process, as the database entry is already removed
          } else {
            console.log('File deleted from file system:', filePath);
          }
        });

        // Emit the event to notify clients that the file has been deleted
        io.to(roomId).emit('file_deleted', fileId);

        // Explicitly send a JSON response
        res.status(200).json({
          success: true,
          message: 'File deleted successfully',
          deletedCount: deleteResult.deletedCount
        });

      } catch (error) {
        console.error('Error in file deletion:', error);

        // Ensure a JSON response is always sent
        res.status(500).json({
          error: 'Internal Server Error',
          details: error.message
        });
      }
    });

    // Socket.IO Connection
    io.on('connection', (socket) => {
      console.log(`User connected: ${socket.id}`);

      // Handle room joining
      socket.on('join_room', async ({ roomId, userName, userId, isCreator }, callback) => {
        let room = await roomsCollection.findOne({ roomId });

        if (!room) {
          if (isCreator) {
            room = {
              roomId,
              text: '',
              messages: [],
              users: {},
              theme: 'light',
              lastActivity: new Date(),
              creatorId: userId,
              isEditable: true, // Default to editable
              editorMode: 'code', // Initialize editor mode to 'code'
            };
            await roomsCollection.insertOne(room);
            console.log(`Room ${roomId} created by ${userName}`);
          } else {
            return callback({ error: 'Room does not exist.' });
          }
        }

        room.users[userId] = userName;
        await roomsCollection.updateOne(
          { roomId },
          { $set: { users: room.users, lastActivity: new Date() } }
        );

        const files = await uploadsCollection.find({ roomId }).toArray();
        socket.join(roomId);

        // Send the current room details including isEditable and isCreator
        callback({
          success: true,
          messages: room.messages,
          theme: room.theme,
          files,
          isCreator: room.creatorId === userId, // Determine if the joining user is the creator
          isEditable: room.isEditable, // Room's editability
          editorMode: room.editorMode, // Current editor mode
          // ydocState is now handled by y-websocket server
        });

        console.log(`${userName} (${userId}) joined room ${roomId}`);
      });

      // Handle toggle_editability
      socket.on('toggle_editability', async ({ roomId, userId }, callback) => {
        const room = await roomsCollection.findOne({ roomId });
        if (!room) {
          return callback({ error: 'Room not found.' });
        }

        if (room.creatorId !== userId) {
          // Only the creator can toggle the editability
          return callback({ error: 'Only the room creator can toggle the editability.' });
        }

        const newEditableState = !room.isEditable;
        await roomsCollection.updateOne(
          { roomId },
          { $set: { isEditable: newEditableState } }
        );

        // Notify all clients in the room about the updated editable state
        io.to(roomId).emit('editable_state_changed', { isEditable: newEditableState });

        if (callback) {
          callback({ success: true, isEditable: newEditableState });
        }
      });

      // Handle toggle_editor_mode
      socket.on('toggle_editor_mode', async ({ roomId, userId }, callback) => {
        try {
          const room = await roomsCollection.findOne({ roomId });
          if (!room) {
            return callback({ error: 'Room not found.' });
          }

          // Optionally, restrict who can toggle the editor mode
          // For example, only the room creator can toggle
          if (room.creatorId !== userId) {
            return callback({ error: 'Only the room creator can toggle the editor mode.' });
          }

          // Toggle the editor mode
          const newEditorMode = room.editorMode === 'code' ? 'text' : 'code';
          await roomsCollection.updateOne(
            { roomId },
            { $set: { editorMode: newEditorMode, lastActivity: new Date() } }
          );

          // Emit the updated editor mode to all clients in the room
          io.to(roomId).emit('editor_mode_changed', { editorMode: newEditorMode });

          console.log(`Room ${roomId} editor mode changed to ${newEditorMode} by user ${userId}`);

          // Optionally, send a success callback
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
        await roomsCollection.updateOne(
          { roomId },
          { $set: { theme, lastActivity: new Date() } }
        );

        io.to(roomId).emit('theme_changed', theme);
      });

      socket.on('disconnect', () => {
        console.log(`User disconnected: ${socket.id}`);
        // Optionally, handle user disconnection from rooms
      });
    });

    // Scheduled Task to Delete Inactive Rooms After 48 Hours (unchanged)
    cron.schedule('0 * * * *', async () => { // Runs every hour at minute 0
      try {
        const now = new Date();
        const cutoffTime = new Date(now.getTime() - 48 * 60 * 60 * 1000); // 48 hours ago

        console.log(`Running scheduled task to delete inactive rooms. Current time: ${now}`);

        // Find rooms with lastActivity older than 48 hours
        const inactiveRooms = await roomsCollection.find({ lastActivity: { $lt: cutoffTime } }).toArray();

        if (inactiveRooms.length === 0) {
          console.log('No inactive rooms found.');
          return;
        }

        console.log(`Found ${inactiveRooms.length} inactive room(s). Deleting...`);

        for (const room of inactiveRooms) {
          const { roomId } = room;

          // Find all files associated with this room
          const associatedFiles = await uploadsCollection.find({ roomId }).toArray();

          // Delete files from the filesystem
          for (const file of associatedFiles) {
            const filename = path.basename(file.fileUrl);
            const filePath = path.join(__dirname, 'uploads', filename);

            fs.unlink(filePath, (err) => {
              if (err) {
                console.error(`Failed to delete file ${filename} from filesystem:`, err);
              } else {
                console.log(`Deleted file ${filename} from filesystem.`);
              }
            });
          }

          // Delete files from the uploads collection
          const deleteFilesResult = await uploadsCollection.deleteMany({ roomId });
          console.log(`Deleted ${deleteFilesResult.deletedCount} file(s) from uploads collection for room ${roomId}.`);

          // Delete the room from the rooms collection
          const deleteRoomResult = await roomsCollection.deleteOne({ roomId });
          if (deleteRoomResult.deletedCount === 1) {
            console.log(`Successfully deleted room ${roomId} from rooms collection.`);
          } else {
            console.warn(`Failed to delete room ${roomId} from rooms collection.`);
          }

          // Notify connected clients that the room has been deleted
          io.to(roomId).emit('room_deleted', { message: 'This room has been deleted due to inactivity.' });
        }

      } catch (error) {
        console.error('Error during scheduled room deletion:', error);
      }
    });

    const PORT = process.env.PORT || 4000;
    server.listen(PORT, () => {
      console.log(`Server is running on http://localhost:${PORT}`);
    });
  } catch (error) {
    console.error('Error starting server:', error);
    process.exit(1);
  }
}

startServer(); // Start the backend Express server
