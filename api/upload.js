import { MongoClient, ObjectId } from 'mongodb';
import multer from 'multer';
import path from 'path';
import fs from 'fs';

// Multer configuration
const storage = multer.memoryStorage(); // We will store the file in memory instead of disk to be uploaded directly to cloud storage
const upload = multer({ storage: storage }).single('file');

// MongoDB connection URI
const MONGO_URI = process.env.MONGO_URI;

let db, roomsCollection, uploadsCollection;

// MongoDB connection
async function connectToDatabase() {
  if (!db) {
    const client = new MongoClient(MONGO_URI);
    await client.connect();
    db = client.db('syncrolly');
    roomsCollection = db.collection('rooms');
    uploadsCollection = db.collection('uploads');
  }
  return db;
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    try {
      // Use multer to parse the uploaded file
      upload(req, res, async (err) => {
        if (err) return res.status(400).json({ error: 'File upload failed', details: err });

        const { roomId } = req.query;
        const { userId } = req.body;
        const file = req.file;

        if (!file) return res.status(400).json({ error: 'No file uploaded.' });

        const fileUrl = `https://yourcdn.com/uploads/${file.filename}`;  // Use cloud storage URL instead of local disk path

        const db = await connectToDatabase();
        const room = await roomsCollection.findOne({ roomId });

        if (!room) return res.status(404).json({ error: 'Room not found.' });

        const userName = room.users[userId];

        // Check if file already exists in the database
        const existingFile = await uploadsCollection.findOne({ roomId, fileUrl });
        if (existingFile) return res.status(400).json({ error: 'This file has already been uploaded.' });

        const newFile = {
          roomId,
          fileName: file.originalname,
          fileUrl,
          uploadedBy: userName,
          uploadedAt: new Date(),
        };

        await uploadsCollection.insertOne(newFile);

        // Emit events using a third-party service (e.g., Socket.IO hosted elsewhere)
        // io.to(roomId).emit('new_file', newFile); 

        return res.status(200).json(newFile);
      });
    } catch (error) {
      return res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
