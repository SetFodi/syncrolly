# 🚀 Syncrolly - Real-Time Collaborative Code Editor

<div align="center">
  <img src="src/assets/syncrolly-logo.png" alt="Syncrolly Logo" width="200"/>
  
  **A modern, real-time collaborative coding platform where developers can write, share, and collaborate on code together.**
  
  [![React](https://img.shields.io/badge/React-19.0.0-blue.svg)](https://reactjs.org/)
  [![Node.js](https://img.shields.io/badge/Node.js-Express-green.svg)](https://nodejs.org/)
  [![Socket.io](https://img.shields.io/badge/Socket.io-4.8.1-red.svg)](https://socket.io/)
  [![Yjs](https://img.shields.io/badge/Yjs-13.6.20-yellow.svg)](https://yjs.dev/)
  [![MongoDB](https://img.shields.io/badge/MongoDB-Database-brightgreen.svg)](https://mongodb.com/)
  [![MIT License](https://img.shields.io/badge/License-MIT-orange.svg)](LICENSE)
</div>

## 📋 Table of Contents

- [✨ Features](#-features)
- [🛠️ Technology Stack](#️-technology-stack)
- [🏗️ Architecture](#️-architecture)
- [🚀 Getting Started](#-getting-started)
- [📁 Project Structure](#-project-structure)
- [🔧 Configuration](#-configuration)
- [💻 Usage](#-usage)
- [🌐 API Endpoints](#-api-endpoints)
- [⚡ Real-time Features](#-real-time-features)
- [🎨 Themes & Customization](#-themes--customization)
- [📱 Responsive Design](#-responsive-design)
- [🔐 Security Features](#-security-features)
- [🚀 Deployment](#-deployment)
- [🧪 Testing](#-testing)
- [📝 License](#-license)
- [👥 Contributing](#-contributing)
- [📞 Contact](#-contact)

## ✨ Features

### 🔄 Real-Time Collaboration
- **Live Code Editing**: Multiple users can edit code simultaneously with instant synchronization
- **Conflict Resolution**: Uses Yjs CRDT (Conflict-free Replicated Data Types) for seamless collaboration
- **Live Cursors**: See where other users are editing in real-time
- **Presence Awareness**: Track who's currently online and active in each room

### 💬 Communication
- **Integrated Chat**: Built-in chat system for each coding room
- **Typing Indicators**: See when other users are typing in chat
- **Message Notifications**: Visual indicators for unread messages
- **Real-time Messaging**: Instant message delivery using Socket.io

### 📝 Code Editor
- **Multi-Language Support**: 
  - JavaScript
  - Python
  - C/C++
  - PHP
  - Markdown
  - JSON
  - Plain Text
- **Syntax Highlighting**: Powered by CodeMirror with language-specific highlighting
- **Code Completion**: Intelligent autocomplete for supported languages
- **Line Wrapping**: Automatic line wrapping for better readability

### 🎛️ Room Management
- **Easy Room Creation**: Generate random room names or create custom ones
- **Access Control**: Room creators can toggle between editable and view-only modes
- **User Management**: Track all users in each room
- **Automatic Cleanup**: Inactive rooms are automatically deleted after 72 hours

### 📁 File Management
- **File Uploads**: Support for multiple file types (images, documents, code files)
- **File Sharing**: Share files with all room participants
- **File Management**: Upload, view, and delete files within rooms
- **Supported Formats**: Images (JPG, PNG), Documents (PDF, TXT), Code files (JS, PY, PHP, etc.)

### 🎨 User Experience
- **Dark/Light Theme**: Toggle between dark and light modes
- **Responsive Design**: Works seamlessly on desktop, tablet, and mobile
- **Beautiful UI**: Modern, clean interface with smooth animations
- **Download Content**: Export your code in the appropriate file format
- **Persistence**: All changes are automatically saved to MongoDB

## 🛠️ Technology Stack

### Frontend
- **React 19.0.0** - Modern UI library with hooks and context
- **React Router DOM 7.0.2** - Client-side routing
- **CodeMirror 6** - Advanced code editor with syntax highlighting
- **Socket.io Client 4.8.1** - Real-time communication
- **Yjs 13.6.20** - Conflict-free collaborative editing
- **Axios 1.7.9** - HTTP client for API requests
- **Styled Components 6.1.13** - CSS-in-JS styling
- **FontAwesome 6.7.1** - Icon library

### Backend
- **Node.js** - JavaScript runtime
- **Express 4.18.2** - Web framework
- **Socket.io 4.6.1** - Real-time bidirectional communication
- **MongoDB 5.7.0** - NoSQL database for data persistence
- **Multer 1.4.5** - File upload middleware
- **CORS 2.8.5** - Cross-origin resource sharing
- **Node-cron 3.0.2** - Task scheduling for cleanup

### Real-time Collaboration
- **Yjs** - Conflict-free replicated data types
- **Y-WebSocket** - WebSocket provider for Yjs
- **Y-LevelDB** - Persistence layer for Yjs documents
- **Y-Protocols** - Awareness and sync protocols

### Database & Storage
- **MongoDB** - Document database for rooms, users, and files
- **LevelDB** - Local storage for Yjs document persistence
- **File System** - Local file storage for uploads

## 🏗️ Architecture

### System Overview
```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   React Client  │    │  Express Server │    │   Yjs Server    │
│                 │    │                 │    │                 │
│  - CodeMirror   │◄──►│  - Socket.io    │◄──►│  - WebSocket    │
│  - Yjs Client   │    │  - REST API     │    │  - CRDT Sync    │
│  - Socket.io    │    │  - File Upload  │    │  - Persistence  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 │
                    ┌─────────────────┐
                    │   MongoDB       │
                    │                 │
                    │  - Rooms        │
                    │  - Messages     │
                    │  - Files        │
                    │  - Users        │
                    └─────────────────┘
```

### Real-time Synchronization Flow
1. **User Types**: CodeMirror captures user input
2. **Yjs Processing**: Changes are processed through Yjs CRDT
3. **WebSocket Sync**: Changes broadcast to all connected clients
4. **Conflict Resolution**: Yjs automatically resolves conflicts
5. **UI Update**: All clients receive and display changes instantly
6. **Persistence**: Changes are debounced and saved to MongoDB

## 🚀 Getting Started

### Prerequisites
- Node.js (v14 or higher)
- MongoDB (local or cloud instance)
- npm or yarn package manager

### Installation

1. **Clone the repository**
   ```bash
   git clone https://github.com/SetFodi/syncrolly.git
   cd syncrolly
   ```

2. **Install frontend dependencies**
   ```bash
   npm install
   ```

3. **Install backend dependencies**
   ```bash
   cd syncrolly-backend
   npm install
   cd ..
   ```

4. **Set up environment variables**
   
   Create `.env` file in the root directory:
   ```env
   REACT_APP_BACKEND_URL=http://localhost:4000
   REACT_APP_YJS_WS_URL=ws://localhost:1234
   ```
   
   Create `.env` file in `syncrolly-backend/` directory:
   ```env
   PORT=4000
   MONGO_URI=mongodb://localhost:27017/syncrolly
   FRONTEND_URLS=http://localhost:3000,https://yourdomain.com
   BACKEND_URL=http://localhost:4000
   ```

5. **Start MongoDB**
   ```bash
   # If using local MongoDB
   mongod
   
   # Or use MongoDB Atlas (cloud) - update MONGO_URI accordingly
   ```

6. **Start the application**
   
   Open three terminal windows:
   
   **Terminal 1 - Frontend:**
   ```bash
   npm start
   ```
   
   **Terminal 2 - Backend Server:**
   ```bash
   cd syncrolly-backend
   npm run backend
   ```
   
   **Terminal 3 - Yjs Server:**
   ```bash
   cd syncrolly-backend
   npm run yjs
   ```

7. **Access the application**
   - Frontend: http://localhost:3000
   - Backend API: http://localhost:4000
   - Yjs WebSocket: ws://localhost:1234

## 📁 Project Structure

```
syncrolly/
├── public/                     # Static files
│   ├── index.html
│   ├── favicon.ico
│   └── ...
├── src/                        # React source code
│   ├── api/                    # API utilities
│   │   └── upload.js
│   ├── assets/                 # Images and static assets
│   │   └── syncrolly-logo.png
│   ├── contexts/               # React contexts
│   │   └── YjsContext.jsx      # Yjs integration
│   ├── pages/                  # React pages
│   │   ├── HomePage.js         # Landing page
│   │   ├── RoomPage.js         # Main collaboration room
│   │   ├── AboutPage.js        # About page
│   │   ├── ContactPage.js      # Contact page
│   │   └── FilesModal.js       # File management modal
│   ├── App.js                  # Main app component
│   ├── App.css                 # Global styles
│   ├── index.js                # Entry point
│   └── socket.js               # Socket.io client setup
├── syncrolly-backend/          # Backend server
│   ├── server.js               # Main Express server
│   ├── yjs-server.js           # Yjs WebSocket server
│   ├── uploads/                # File upload storage
│   ├── yjs-data/               # Yjs persistence data
│   └── package.json            # Backend dependencies
├── package.json                # Frontend dependencies
└── README.md                   # This file
```

## 🔧 Configuration

### Environment Variables

#### Frontend (.env)
```env
REACT_APP_BACKEND_URL=http://localhost:4000
REACT_APP_YJS_WS_URL=ws://localhost:1234
```

#### Backend (syncrolly-backend/.env)
```env
PORT=4000
MONGO_URI=mongodb://localhost:27017/syncrolly
FRONTEND_URLS=http://localhost:3000,https://yourdomain.com
BACKEND_URL=http://localhost:4000
```

### MongoDB Collections

The application uses three main collections:

1. **rooms** - Stores room data, users, messages, and content
2. **uploads** - Stores file upload metadata
3. **activeUsers** - Tracks currently connected users

### File Upload Configuration

Supported file types:
- Images: .jpeg, .jpg, .png
- Documents: .pdf, .txt, .html
- Code: .js, .css, .py, .php
- Archives: .zip, .rar, .7z

Maximum file size: 10MB

## 💻 Usage

### Creating a Room

1. **Visit the homepage** at http://localhost:3000
2. **Click "Create Room"** button
3. **Enter your name** and optionally a room name
4. **Click "Join Room"** to create and enter the room

### Collaborating in a Room

1. **Share the room URL** with other participants
2. **Start coding** - changes sync automatically
3. **Use the chat** to communicate with other users
4. **Upload files** to share resources
5. **Toggle theme** between light and dark modes

### Room Management (Creator Only)

- **Toggle Editability**: Switch between editable and view-only modes
- **File Management**: Upload and delete files
- **User Monitoring**: See who's currently in the room

### Downloading Content

1. **Select the language** from the dropdown
2. **Click "Download"** to export code with the appropriate file extension
3. **File is saved** as `syncrolly_content.{extension}`

## 🌐 API Endpoints

### Room Management
- `POST /room/:roomId/content` - Save room content
- `GET /room/:roomId/content` - Get room content

### File Operations
- `POST /upload/:roomId` - Upload file to room
- `DELETE /delete_file/:roomId/:fileId` - Delete file from room
- `GET /uploads/:filename` - Serve uploaded files

### Health Check
- `GET /health` - Server health status

### WebSocket Events

#### Client to Server
- `join_room` - Join a collaboration room
- `send_message` - Send chat message
- `typing_start` - Start typing indicator
- `typing_stop` - Stop typing indicator
- `toggle_editability` - Toggle room edit mode

#### Server to Client
- `receive_message` - Receive chat message
- `user_typing` - User typing indicator
- `user_stopped_typing` - User stopped typing
- `editable_state_changed` - Edit mode changed
- `room_deleted` - Room was deleted

## ⚡ Real-time Features

### Collaborative Editing
- **Operational Transformation**: Yjs handles conflicting edits automatically
- **Live Cursors**: See other users' cursor positions
- **Instant Sync**: Changes appear on all clients within milliseconds
- **Offline Support**: Changes are queued and synced when connection resumes

### Chat System
- **Real-time Messaging**: Messages appear instantly
- **Typing Indicators**: See when others are typing
- **Message Persistence**: Chat history is saved to MongoDB
- **Notifications**: Visual indicators for unread messages

### Presence Awareness
- **Online Users**: Track who's currently in each room
- **Active Status**: See user activity in real-time
- **Connection Status**: Monitor connection state

## 🎨 Themes & Customization

### Theme Support
- **Light Theme**: Clean, bright interface for day use
- **Dark Theme**: Easy on the eyes for night coding
- **Auto-save**: Theme preference saved to localStorage
- **Instant Toggle**: Switch themes without page reload

### Customization Options
- **Language Selection**: Choose from 7 programming languages
- **Editor Settings**: Line wrapping, syntax highlighting
- **UI Preferences**: Theme, chat visibility, file modal

## 📱 Responsive Design

### Desktop (1200px+)
- Full-featured interface with sidebar panels
- Multi-column layout for optimal screen usage
- Hover effects and advanced interactions

### Tablet (768px - 1199px)
- Adapted layout with collapsible panels
- Touch-friendly interface elements
- Optimized for both portrait and landscape

### Mobile (< 768px)
- Streamlined interface with bottom navigation
- Touch-optimized controls
- Responsive chat and file management

## 🔐 Security Features

### Data Protection
- **Input Validation**: All user inputs are validated
- **File Type Checking**: Only allowed file types can be uploaded
- **Size Limits**: 10MB maximum file size
- **CORS Protection**: Configured for allowed origins only

### Room Security
- **Creator Controls**: Only room creators can change settings
- **Auto-cleanup**: Inactive rooms deleted after 72 hours
- **User Validation**: User authentication for room access

## 🚀 Deployment

### Production Environment Variables

#### Frontend
```env
REACT_APP_BACKEND_URL=https://your-backend-domain.com
REACT_APP_YJS_WS_URL=wss://your-yjs-domain.com
```

#### Backend
```env
PORT=4000
MONGO_URI=mongodb+srv://user:pass@cluster.mongodb.net/syncrolly
FRONTEND_URLS=https://your-frontend-domain.com,https://www.yourdomain.com
BACKEND_URL=https://your-backend-domain.com
```

### Build Commands

#### Frontend
```bash
npm run build
```

#### Backend
```bash
# Backend runs directly with Node.js
node server.js
node yjs-server.js
```

### Deployment Platforms
- **Frontend**: Vercel, Netlify, or any static host
- **Backend**: Heroku, Railway, Render, or any Node.js host
- **Database**: MongoDB Atlas (recommended)

## 🧪 Testing

### Running Tests
```bash
# Frontend tests
npm test

# Backend tests (if implemented)
cd syncrolly-backend
npm test
```

### Test Coverage
- Component rendering tests
- Socket.io event handling
- API endpoint testing
- Yjs synchronization tests

## 📝 License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

## 👥 Contributing

We welcome contributions! Here's how you can help:

1. **Fork the repository**
2. **Create a feature branch** (`git checkout -b feature/amazing-feature`)
3. **Commit your changes** (`git commit -m 'Add amazing feature'`)
4. **Push to the branch** (`git push origin feature/amazing-feature`)
5. **Open a Pull Request**

### Development Guidelines
- Follow React best practices
- Use proper TypeScript types (if applicable)
- Write unit tests for new features
- Update documentation as needed
- Follow the existing code style

### Reporting Issues
- Use the GitHub Issues tab
- Provide detailed reproduction steps
- Include browser/OS information
- Add screenshots if applicable

## 📞 Contact

### Developer
- **Name**: Your Name
- **Company**: LGA Corporation
- **Instagram**: [@syncrolly](https://www.instagram.com/syncrolly/)
- **Website**: [syncrolly.com](https://syncrolly.com)

### Support
- **Email**: support@syncrolly.com
- **GitHub Issues**: [Create an issue](https://github.com/yourusername/syncrolly/issues)
- **Documentation**: [Wiki](https://github.com/yourusername/syncrolly/wiki)

---

<div align="center">
  <p>Made with ❤️ by LGA Corporation</p>
  <p>© 2024 LGA Corporation. All rights reserved.</p>
</div>
