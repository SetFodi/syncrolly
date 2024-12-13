import { MongoClient, ObjectId } from 'mongodb';

const MONGO_URI = process.env.MONGO_URI;

let db, roomsCollection, uploadsCollection;

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
  if (req.method === 'DELETE') {
    try {
      const { roomId, fileId } = req.query;

      // Validate file ID
      if (!ObjectId.isValid(fileId)) {
        return res.status(400).json({ error: 'Invalid file ID format.' });
      }

      const db = await connectToDatabase();
      const fileToDelete = await uploadsCollection.findOne({ roomId, _id: new ObjectId(fileId) });

      if (!fileToDelete) return res.status(404).json({ error: 'File not found.' });

      // Delete the file document from MongoDB
      await uploadsCollection.deleteOne({ _id: new ObjectId(fileId) });

      // (Optionally) Delete the file from cloud storage here, e.g., Amazon S3 or Google Cloud Storage

      res.status(200).json({ success: true, message: 'File deleted successfully' });
    } catch (error) {
      res.status(500).json({ error: 'Internal Server Error', details: error.message });
    }
  } else {
    res.status(405).json({ error: 'Method Not Allowed' });
  }
}
