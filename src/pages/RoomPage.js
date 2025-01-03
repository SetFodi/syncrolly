// frontend/src/pages/RoomPage.jsx
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import socket from '../socket';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import styles from './RoomPage.module.css';
import FilesModal from './FilesModal';
import '@fortawesome/fontawesome-free/css/all.min.css';
import { useYjs, YjsProvider } from '../contexts/YjsContext';
import { yCollab } from 'y-codemirror.next';
import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';

function RoomPageContent() {
  const { roomId } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const initialIsCreator = location.state?.isCreator || false;

  const [isCreator, setIsCreator] = useState(initialIsCreator);
  const [filesModalVisible, setFilesModalVisible] = useState(false);
  const storedUserId = localStorage.getItem('userId') || uuidv4();
  const storedUserName = localStorage.getItem('userName') || '';
  const storedTheme = localStorage.getItem('theme') || 'light';

  if (!localStorage.getItem('userId')) {
    localStorage.setItem('userId', storedUserId);
  }
  console.log('Room ID:', roomId);

  const [userName, setUserName] = useState(storedUserName);
  const [isNameSet, setIsNameSet] = useState(!!storedUserName);

  // Chat + other states
  const [messages, setMessages] = useState([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [theme, setTheme] = useState(storedTheme);
  const [typingUsers, setTypingUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileInput, setFileInput] = useState(null);
  const [isEditable, setIsEditable] = useState(false);
  const [loading, setLoading] = useState(isNameSet);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false);
  const typingTimeoutRef = useRef(null);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState('javascript');
  const [syncTimeout, setSyncTimeout] = useState(false);

  // This is your Yjs context
  const { ydoc, awareness, isYjsSynced } = useYjs();

  // Setup language to extension mapping
  const languageExtensions = useMemo(() => ({
    javascript: javascript(),
    python: python(),
    cpp: cpp(),
    php: php(),
    markdown: markdown(),
    json: javascript(), 
    text: markdown(),
  }), []);

  // On mount, join the room for chat, file data, etc.
  useEffect(() => {
    if (!isNameSet) return;

    setLoading(true);
    console.log('Attempting to join room:', {
      roomId, userName: storedUserName, userId: storedUserId, isCreator
    });

    socket.emit('join_room', {
      roomId, userName: storedUserName, userId: storedUserId, isCreator
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
        // We do NOT manually set ydoc text from response.text 
        // because Yjs WebSocket server is already loading it.
        setLoading(false);
      }
    });

    // Listen for editability changes
    socket.on('editable_state_changed', ({ isEditable: newIsEditable }) => {
      console.log(`Editability changed to: ${newIsEditable}`);
      setIsEditable(newIsEditable);
    });

    // Listen for new chat messages
    socket.on('receive_message', (message) => {
      console.log('Received message:', message);
      setMessages((prev) => [...prev, message]);
      if (!chatVisible) setHasUnreadMessages(true);
    });

    // Listen for typing
    socket.on('user_typing', ({ userId, userName }) => {
      console.log(`${userName} is typing...`);
      setTypingUsers((prev) => {
        if (!prev.some(u => u.userId === userId)) {
          return [...prev, { userId, userName }];
        }
        return prev;
      });
    });

    socket.on('user_stopped_typing', ({ userId }) => {
      console.log(`User ${userId} stopped typing.`);
      setTypingUsers((prev) => prev.filter(u => u.userId !== userId));
    });

    // Handle room deletion
    socket.on('room_deleted', ({ message, deleteAfter }) => {
      if (deleteAfter && new Date() > new Date(deleteAfter)) {
        alert(message);
        // Clear local content (though Yjs server also handles it)
        ydoc.getText('shared-text').delete(0, ydoc.getText('shared-text').length);
        navigate('/');
      } else {
        alert(message);
      }
    });

    return () => {
      // Cleanup socket listeners
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
    isNameSet, roomId, storedUserName, storedUserId, isCreator,
    navigate, chatVisible, ydoc
  ]);

  // If Yjs is not synced, maybe show a "Connecting..." overlay
  // We'll do a 10s timeout for a fallback
  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => {
        setSyncTimeout(true);
        setLoading(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  // No more "debounced save_content" or final "save_content" on unmount 
  // because the Yjs server handles that for us.

  // Name submission
  const handleNameSubmit = () => {
    if (userName.trim()) {
      localStorage.setItem('userName', userName);
      setIsNameSet(true);
    } else {
      alert('Please enter a valid name.');
    }
  };

  // Download the current doc content from Yjs
  const handleDownload = () => {
    const content = ydoc.getText('shared-text').toString();
    const fileExtensionMap = {
      javascript: 'js',
      python: 'py',
      cpp: 'cpp',
      php: 'php',
      markdown: 'md',
      json: 'json',
      text: 'txt'
    };
    const fileExtension =
      fileExtensionMap[selectedLanguage] || 'txt';

    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `syncrolly_content.${fileExtension}`;
    link.click();
  };

  // Toggle editability (Socket.IO -> DB update)
  const handleEditableToggle = () => {
    if (!isCreator) return;
    socket.emit('toggle_editability', {
      roomId,
      userId: storedUserId
    }, (response) => {
      if (response.error) {
        alert(response.error);
      } else {
        console.log(`Editability toggled to ${response.isEditable}`);
        setIsEditable(response.isEditable);
        alert(`Room is now ${response.isEditable ? 'editable' : 'view-only'}.`);
      }
    });
  };

  // Send chat messages
  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    socket.emit('send_message', {
      roomId, userId: storedUserId, message: chatInput
    });
    setChatInput('');
  };

  // File upload logic remains the same...
  // handleFileUpload, handleDeleteFile, etc.

  // Toggle theme
  const toggleTheme = () => {
    const newTheme = (theme === 'light') ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  // Toggle chat
  const toggleChatBox = () => {
    setChatVisible(!chatVisible);
    if (!chatVisible) setHasUnreadMessages(false);
    console.log('Current Yjs content:', ydoc.getText('shared-text').toString());
  };

  // Typing indicators
  const handleTypingStart = () => {
    if (!isTyping) {
      socket.emit('typing_start', {
        roomId, userId: storedUserId, userName
      });
      setIsTyping(true);
    }
    if (typingTimeoutRef.current) clearTimeout(typingTimeoutRef.current);
    typingTimeoutRef.current = setTimeout(() => {
      handleTypingStop();
    }, 3000);
  };

  const handleTypingStop = () => {
    if (isTyping) {
      socket.emit('typing_stop', {
        roomId, userId: storedUserId
      });
      setIsTyping(false);
    }
    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  };

  // CodeMirror Extensions
  const editorExtensions = useMemo(() => {
    const baseExt = languageExtensions[selectedLanguage] || markdown();
    return [
      baseExt,
      EditorView.lineWrapping,
      EditorView.editable.of(isEditable || isCreator),
      // The yCollab extension automatically syncs text 
      // with the Yjs doc's "shared-text".
      yCollab(ydoc.getText('shared-text'), awareness, {})
    ];
  }, [
    isEditable, isCreator, awareness, selectedLanguage,
    languageExtensions, ydoc
  ]);

  // Render UI
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
          {/* Header */}
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
                {isEditable ? "Set to View-Only" : "Make Editable"}
              </button>
            )}

            {/* Chat, Files, Download buttons */}
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
              <button
                onClick={toggleTheme}
                className={styles['theme-btn']}
                aria-label="Toggle Theme"
              >
                {theme === 'light' ? <i className="fas fa-moon"></i> : <i className="fas fa-sun"></i>}
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

          {/* Main Editor */}
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
                    ? "Synchronization is taking longer than usual. The editor will be available shortly."
                    : "Synchronizing editor content..."}
                </p>
              </div>
            )}
          </div>

          {/* Typing Indicator */}
          <div className={styles['typing-indicator']}>
            {typingUsers.length > 0 && (
              <p>
                {typingUsers.map(u => u.userName).join(', ')}{' '}
                {typingUsers.length > 1 ? 'are' : 'is'} typing...
              </p>
            )}
          </div>

          {/* Chat Box */}
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

          {/* Files Modal */}
          {filesModalVisible && (
            <FilesModal
              files={files}
              fileInput={fileInput}
              setFileInput={setFileInput}
              // handleFileUpload, handleDeleteFile, etc.
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
              <i className="fab fa-instagram" style={{ marginLeft: '8px' }}></i>
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
