import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import socket from '../socket'; // Ensure socket.io-client is correctly set up
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import styles from './RoomPage.module.css';
import FilesModal from './FilesModal';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { useYjs, YjsProvider } from '../contexts/YjsContext'; // Import the Yjs context
import { yCollab } from 'y-codemirror.next'; // Yjs extension for CodeMirror
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';

function RoomPageContent() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();

  // If a user is the creator, pass `isCreator: true` when navigating
  const initialIsCreator = location.state?.isCreator || false;
  const [isCreator, setIsCreator] = useState(initialIsCreator);

  // For file modal, chat, etc.
  const [filesModalVisible, setFilesModalVisible] = useState(false);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([]);
  const [typingUsers, setTypingUsers] = useState([]);
  const [isTyping, setIsTyping] = useState(false);

  // For language selection, theme, etc.
  const [selectedLanguage, setSelectedLanguage] = useState('javascript');
  const [theme, setTheme] = useState(localStorage.getItem('theme') || 'light');

  // For user info
  const storedUserId = localStorage.getItem('userId') || uuidv4();
  const storedUserName = localStorage.getItem('userName') || '';
  const [userName, setUserName] = useState(storedUserName);
  const [isNameSet, setIsNameSet] = useState(Boolean(storedUserName));

  // If no userId in localStorage, set it
  if (!localStorage.getItem('userId')) {
    localStorage.setItem('userId', storedUserId);
  }

  // Editor/room states
  const [isEditable, setIsEditable] = useState(false);
  const [files, setFiles] = useState([]);
  const [fileInput, setFileInput] = useState(null);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const [loading, setLoading] = useState(isNameSet);
  const [syncTimeout, setSyncTimeout] = useState(false);

  // We track Yjs doc from context
  const { ydoc, awareness, isYjsSynced } = useYjs();
  const hasInitialSync = useRef(false);
  const typingTimeoutRef = useRef(null);

  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  console.log('Backend URL:', backendUrl);
  console.log('Room ID:', roomId);

  // Language handling
  const languageExtensions = useMemo(() => ({
    javascript: javascript(),
    python: python(),
    cpp: cpp(),
    php: php(),
    markdown: markdown(),
    json: javascript(), // Fallback to JS for JSON
    text: markdown(),   // Fallback to markdown for plain text
  }), []);

  // ---------------
  // Socket.io Setup
  // ---------------
  useEffect(() => {
    if (!isNameSet) return;

    setLoading(true);
    console.log('Attempting to join room with:', {
      roomId,
      userName: storedUserName,
      userId: storedUserId,
      isCreator
    });

    socket.emit('join_room', {
      roomId,
      userName: storedUserName,
      userId: storedUserId,
      isCreator
    }, (response) => {
      console.log('join_room response:', response);
      if (response.error) {
        alert(response.error);
        setLoading(false);
        return;
      }
      if (response.success) {
        console.log('Joined room successfully:', response);
        setFiles(response.files);
        setMessages(response.messages);
        setIsEditable(response.isEditable);
        setIsCreator(response.isCreator);

        // If the DB text is non-empty, and the local Yjs doc is empty,
        // put the DB text into the doc once.
        if (response.text && ydoc) {
          const ytext = ydoc.getText('shared-text');
          if (ytext.toString() === '') {
            ytext.insert(0, response.text);
          }
        }
        setLoading(false);
      }
    });

    // Listen for toggles, messages, typing, etc.
    socket.on('editable_state_changed', ({ isEditable: newIsEditable }) => {
      console.log(`Editability changed to: ${newIsEditable}`);
      setIsEditable(newIsEditable);
    });

    socket.on('receive_message', (message) => {
      console.log('Received message:', message);
      setMessages((prev) => [...prev, message]);
      if (!chatVisible) {
        setHasUnreadMessages(true);
      }
    });

    socket.on('user_typing', ({ userId, userName }) => {
      console.log(`${userName} is typing...`);
      setTypingUsers((prev) => {
        if (!prev.some((u) => u.userId === userId)) {
          return [...prev, { userId, userName }];
        }
        return prev;
      });
    });

    socket.on('user_stopped_typing', ({ userId }) => {
      console.log(`User ${userId} stopped typing.`);
      setTypingUsers((prev) => prev.filter((u) => u.userId !== userId));
    });

    socket.on('room_deleted', ({ message, deleteAfter }) => {
      if (deleteAfter && new Date() > new Date(deleteAfter)) {
        alert(message);
        // Clear doc
        ydoc.getText('shared-text').delete(0, ydoc.getText('shared-text').length);
        navigate('/');
      } else {
        alert(message);
      }
    });

    return () => {
      socket.off('new_file');
      socket.off('receive_message');
      socket.off('user_typing');
      socket.off('user_stopped_typing');
      socket.off('editable_state_changed');
      socket.off('theme_changed');
      socket.off('room_deleted');
      socket.off('room_joined');
      socket.off('content_update');
    };
  }, [
    isNameSet,
    roomId,
    storedUserName,
    storedUserId,
    isCreator,
    navigate,
    chatVisible,
    ydoc
  ]);

  // Handle room joined event
  useEffect(() => {
    const handleRoomJoined = (roomData) => {
      // We rely on the Yjs server for content, so do nothing here
      console.log('Room data:', roomData);
    };
    socket.on('room_joined', handleRoomJoined);
    return () => {
      socket.off('room_joined', handleRoomJoined);
    };
  }, [ydoc, roomId]);

  // ---------------
  // Yjs Sync Checks
  // ---------------
  useEffect(() => {
    if (ydoc && isYjsSynced && !hasInitialSync.current) {
      hasInitialSync.current = true;
      console.log('Yjs initial sync completed');
    }
  }, [ydoc, isYjsSynced]);

  // ---------------
  // Remove Manual Save to Socket.IO
  // ---------------
  // (We no longer do any "socket.emit('save_content')" here.)

  // Just a small local observer to show text in console
  useEffect(() => {
    const ytext = ydoc.getText('shared-text');
    const observer = () => {
      console.log('Local YJS doc changed:', ytext.toString());
    };
    ytext.observe(observer);
    return () => {
      ytext.unobserve(observer);
    };
  }, [ydoc]);

  // ---------------
  // Loading Timeout
  // ---------------
  useEffect(() => {
    if (!loading) return;
    const timer = setTimeout(() => {
      setSyncTimeout(true);
      setLoading(false);
    }, 10000);
    return () => clearTimeout(timer);
  }, [loading]);

  // ---------------
  // Name Submission
  // ---------------
  const handleNameSubmit = () => {
    if (userName.trim()) {
      console.log('Setting user name:', userName);
      localStorage.setItem('userName', userName);
      setIsNameSet(true);
    } else {
      alert('Please enter a valid name.');
    }
  };

  // ---------------
  // Download
  // ---------------
  const handleDownload = () => {
    const content = ydoc.getText('shared-text').toString();
    const exts = {
      javascript: 'js',
      python: 'py',
      cpp: 'cpp',
      php: 'php',
      markdown: 'md',
      json: 'json',
      text: 'txt'
    };
    const fileExt = exts[selectedLanguage] || 'txt';
    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `syncrolly_content.${fileExt}`;
    link.click();
  };

  // ---------------
  // Toggle Editable
  // ---------------
  const handleEditableToggle = () => {
    if (!isCreator) return;
    socket.emit('toggle_editability', { roomId, userId: storedUserId }, (res) => {
      if (res.error) {
        alert(res.error);
      } else {
        console.log(`Editability toggled to ${res.isEditable}`);
        setIsEditable(res.isEditable);
        alert(`Room is now ${res.isEditable ? 'editable' : 'view-only'}.`);
      }
    });
  };

  // ---------------
  // Chat Send
  // ---------------
  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    socket.emit('send_message', {
      roomId,
      userId: storedUserId,
      message: chatInput
    });
    setChatInput('');
  };

  // ---------------
  // File Upload
  // ---------------
  const handleFileUpload = async () => {
    if (!fileInput) {
      alert('Please select a file to upload.');
      return;
    }
    const formData = new FormData();
    formData.append('file', fileInput);
    formData.append('userId', storedUserId);

    try {
      const response = await fetch(`${backendUrl}/upload/${roomId}`, {
        method: 'POST',
        body: formData,
        mode: 'cors',
        credentials: 'include'
      });
      const responseText = await response.text();
      if (response.ok) {
        const data = JSON.parse(responseText);
        setFiles((prev) => {
          if (!prev.some((f) => f.fileUrl === data.fileUrl)) {
            return [...prev, data];
          }
          return prev;
        });
        socket.emit('new_file', data);
        alert('File uploaded successfully');
      } else {
        try {
          const errorData = JSON.parse(responseText);
          alert('Upload failed: ' + errorData.error);
        } catch (parseError) {
          alert('Upload failed: ' + responseText);
        }
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('File upload failed: ' + error.message);
    }
  };

  // ---------------
  // File Delete
  // ---------------
  const handleDeleteFile = async (fileId) => {
    try {
      const response = await fetch(`${backendUrl}/delete_file/${roomId}/${fileId}`, {
        method: 'DELETE',
        mode: 'cors',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      const responseText = await response.text();
      if (response.ok) {
        alert('File deleted successfully');
        setFiles((prev) => prev.filter((f) => f._id !== fileId));
      } else {
        try {
          const errorData = JSON.parse(responseText);
          alert(errorData.error || 'Failed to delete file');
        } catch (err) {
          alert('Failed to delete file: ' + responseText);
        }
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Error deleting file: ' + error.message);
    }
  };

  // ---------------
  // Toggle Theme
  // ---------------
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  // ---------------
  // Toggle Chat
  // ---------------
  const toggleChatBox = () => {
    setChatVisible(!chatVisible);
    if (!chatVisible) {
      setHasUnreadMessages(false);
    }
    console.log('Yjs Document Content:', ydoc.getText('shared-text').toString());
  };

  // ---------------
  // Typing Start/Stop
  // ---------------
  const handleTypingStart = () => {
    if (!isTyping) {
      socket.emit('typing_start', {
        roomId,
        userId: storedUserId,
        userName
      });
      setIsTyping(true);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
    typingTimeoutRef.current = setTimeout(() => {
      handleTypingStop();
    }, 3000);
  };

  const handleTypingStop = () => {
    if (isTyping) {
      socket.emit('typing_stop', { roomId, userId: storedUserId });
      setIsTyping(false);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  };

  // ---------------
  // Editor Extensions
  // ---------------
  const editorExtensions = useMemo(() => {
    const baseExtension = languageExtensions[selectedLanguage];
    return [
      baseExtension || markdown(),
      EditorView.lineWrapping,
      EditorView.editable.of(isEditable || isCreator),
      yCollab(ydoc.getText('shared-text'), awareness, {})
    ];
  }, [
    isEditable,
    isCreator,
    awareness,
    selectedLanguage,
    languageExtensions,
    ydoc
  ]);

  // ---------------
  // Render
  // ---------------
  return (
    <div className={`${styles['room-container']} ${styles[theme]}`}>
      {!isNameSet ? (
        <div className={styles['name-setup']}>
          <h1>Welcome to Room: {roomId}</h1>
          <p>Please enter your name to join the room:</p>
          <input
            type="text"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className={styles['name-input']}
            placeholder="Enter your name"
            aria-label="User Name"
          />
          <button onClick={handleNameSubmit} className={styles['submit-btn']}>
            Set Name
          </button>
        </div>
      ) : (
        <>
          <div className={styles['header']}>
            <div className={styles['logo-container']}>
              <Link to="/">
                <img
                  src={require('../assets/syncrolly-logo.png')}
                  alt="Syncrolly Logo"
                  className={styles['syncrolly-logo']}
                />
              </Link>
            </div>
            <h1>Room: {roomId}</h1>
            {isCreator && (
              <button
                onClick={handleEditableToggle}
                className={`${styles['toggle-btn']} ${isEditable ? styles['editable'] : styles['viewOnly']}`}
                aria-label={isEditable ? 'Set to View-Only' : 'Make Editable'}
              >
                <span className="icon"></span>
                {isEditable ? 'Set to View-Only' : 'Make Editable'}
              </button>
            )}

            <div className={styles['chat-toggle']}>
              <button
                onClick={toggleChatBox}
                className={styles['chat-btn']}
                aria-label={chatVisible ? 'Close Chat' : 'Open Chat'}
              >
                {hasUnreadMessages && (
                  <span className={styles['notification-badge']} aria-label="New chat messages">
                    New!
                  </span>
                )}
                {chatVisible ? 'Close Chat' : 'Chat'}
              </button>
              <button
                onClick={() => setFilesModalVisible(true)}
                className={styles['files-btn']}
                aria-label="View Files"
              >
                View Files
              </button>
              <button
                onClick={handleDownload}
                className={styles['download-btn']}
                aria-label="Download Content"
              >
                Download
              </button>
            </div>

            <div className={styles['theme-toggle']}>
              <button onClick={toggleTheme} className={styles['theme-btn']} aria-label="Toggle Theme">
                {theme === 'light' ? <i className="fas fa-moon" /> : <i className="fas fa-sun" />}
              </button>
            </div>

            {/* Language Selector */}
            <div className={styles['language-select']}>
              <label htmlFor="language-select">Language:</label>
              <select
                id="language-select"
                value={selectedLanguage}
                onChange={(e) => setSelectedLanguage(e.target.value)}
                aria-label="Select Language"
              >
                <option value="javascript">JavaScript</option>
                <option value="python">Python</option>
                <option value="cpp">C/C++</option>
                <option value="php">PHP</option>
                <option value="markdown">Markdown</option>
                <option value="json">JSON</option>
                <option value="text">Text</option>
              </select>
            </div>
          </div>

          <div className={styles['main-content']}>
            <CodeMirror
              extensions={editorExtensions}
              className={`${styles['code-editor']} ${styles[theme]}`}
              readOnly={!(isEditable || isCreator)}
              aria-label="Code Editor"
            />
            {!isYjsSynced && loading && (
              <div className={styles['yjs-loading-overlay']}>
                <p>
                  {syncTimeout
                    ? 'Synchronization is taking longer than usual. The editor will be available shortly.'
                    : 'Synchronizing editor content...'}
                </p>
              </div>
            )}
          </div>

          <div className={styles['typing-indicator']}>
            {typingUsers.length > 0 && (
              <p>
                {typingUsers.map((u) => u.userName).join(', ')}{' '}
                {typingUsers.length > 1 ? 'are' : 'is'} typing...
              </p>
            )}
          </div>

          <div className={`${styles['chat-box']} ${chatVisible ? styles['open'] : ''} ${styles[theme]}`}>
            <button
              onClick={toggleChatBox}
              className={styles['close-btn']}
              aria-label="Close Chat"
            >
              X
            </button>
            <div className={styles['messages']}>
              {messages.map((msg, index) => (
                <div key={index} className={styles['message']}>
                  <strong>{msg.userName}:</strong> {msg.text}
                </div>
              ))}
            </div>
            <input
              type="text"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              className={styles['chat-input']}
              onFocus={handleTypingStart}
              onBlur={handleTypingStop}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  handleSendMessage();
                }
              }}
              placeholder="Type your message..."
              aria-label="Chat Input"
            />
            <button
              onClick={handleSendMessage}
              className={styles['send-btn']}
              aria-label="Send Message"
            >
              Send
            </button>
          </div>

          {filesModalVisible && (
            <FilesModal
              files={files}
              fileInput={fileInput}
              setFileInput={setFileInput}
              handleFileUpload={handleFileUpload}
              handleDeleteFile={handleDeleteFile}
              onClose={() => setFilesModalVisible(false)}
            />
          )}
        </>
      )}
      <footer className={styles['footer']}>
        <div className={styles['footer-content']}>
          <p>&copy; 2024 <strong>LGA Corporation</strong>. All rights reserved.</p>
          <p>
            Contact us on{' '}
            <a
              href="https://www.instagram.com/syncrolly/"
              target="_blank"
              rel="noopener noreferrer"
              className={styles['contact-link']}
              aria-label="Visit Syncrolly's Instagram profile"
            >
              Instagram
              <i className="fab fa-instagram" style={{ marginLeft: '8px' }} />
            </a>
          </p>
        </div>
      </footer>
    </div>
  );
}

function RoomPage() {
  const { roomId } = useParams();
  return (
    <YjsProvider roomId={roomId}>
      <RoomPageContent />
    </YjsProvider>
  );
}

export default RoomPage;
