// frontend/src/pages/RoomPage.jsx

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
import { debounce } from 'lodash';

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
  const [messages, setMessages] = useState([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [theme, setTheme] = useState(storedTheme);
  const [typingUsers, setTypingUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileInput, setFileInput] = useState(null);
  const [isEditable, setIsEditable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false); // New state for chat notifications
  const typingTimeoutRef = useRef(null);
  const [connectionStatus, setConnectionStatus] = useState('connecting');
const [retryCount, setRetryCount] = useState(0);
  const [contentSynced, setContentSynced] = useState(false);
  const hasInitialSync = useRef(false);
  const contentSyncedRef = useRef(false);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("javascript"); // Updated initial value
  const [syncTimeout, setSyncTimeout] = useState(false);
  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  console.log('Backend URL:', backendUrl);

  // Language handling
  const languageExtensions = useMemo(() => ({
    javascript: javascript(),
    python: python(),
    cpp: cpp(),
    php: php(),
    markdown: markdown(),
    json: javascript(), // Fallback to JavaScript for JSON
    text: markdown(),   // Fallback to Markdown for plain text
  }), []);
const retryWithTimeout = async (operation, maxAttempts = 5, initialDelay = 1000) => {
  let currentAttempt = 0;
  let delay = initialDelay;

  while (currentAttempt < maxAttempts) {
    try {
      const result = await operation();
      return { success: true, data: result };
    } catch (error) {
      currentAttempt++;
      if (currentAttempt === maxAttempts) {
        return { success: false, error };
      }
      // Exponential backoff with a maximum of 8 seconds
      delay = Math.min(delay * 1.5, 8000);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
};
  // Access Yjs context
  const { ydoc, awareness, isYjsSynced } = useYjs();

  // Initialize Socket.IO Events
useEffect(() => {
  if (isNameSet && ydoc) {
    setLoading(true);
    setConnectionStatus('connecting');
    console.log('Attempting to join room with:', { roomId, userName: storedUserName, userId: storedUserId, isCreator });

    const joinRoom = async () => {
      const result = await retryWithTimeout(
        () => new Promise((resolve, reject) => {
          socket.emit('join_room', 
            { roomId, userName: storedUserName, userId: storedUserId, isCreator }, 
            (response) => {
              if (response.error) {
                reject(response.error);
              } else {
                resolve(response);
              }
            }
          );
        }),
        5, // max attempts
        1000 // initial delay
      );

      if (result.success) {
        console.log('Joined room successfully:', result.data);
        setFiles(result.data.files);
        setMessages(result.data.messages);
        setIsEditable(result.data.isEditable);
        setIsCreator(result.data.isCreator);
        setConnectionStatus('connected');
        setLoading(false);
      } else {
        setConnectionStatus('failed');
        setLoading(false);
        alert('Failed to connect to the room. The server might be waking up. Please try again in a moment.');
      }
    };

    joinRoom();

      // Listen for editability changes
      socket.on('editable_state_changed', ({ isEditable: newIsEditable }) => {
        console.log(`Editability changed to: ${newIsEditable}`);
        setIsEditable(newIsEditable);
      });

      // Listen for new messages
      socket.on('receive_message', (message) => {
        console.log('Received message:', message);
        setMessages((prevMessages) => [...prevMessages, message]);

        // If chat is not visible, set unread messages flag
        if (!chatVisible) {
          setHasUnreadMessages(true);
        }
      });

      // Listen for typing indicators
      socket.on('user_typing', ({ userId, userName }) => {
        console.log(`${userName} is typing...`);
        setTypingUsers((prevTypingUsers) => {
          if (!prevTypingUsers.some(user => user.userId === userId)) {
            return [...prevTypingUsers, { userId, userName }];
          }
          return prevTypingUsers;
        });
      });

      socket.on('user_stopped_typing', ({ userId }) => {
        console.log(`User ${userId} stopped typing.`);
        setTypingUsers((prevTypingUsers) => prevTypingUsers.filter(user => user.userId !== userId));
      });

      socket.on('room_deleted', ({ message, deleteAfter }) => {
        if (deleteAfter && new Date() > new Date(deleteAfter)) {
          alert(message);
          // Clear the content to sync with the deletion
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
    }
  }, [isNameSet, roomId, storedUserName, storedUserId, isCreator, navigate, chatVisible, ydoc]);

  // Handle room joined event
useEffect(() => {
  const handleRoomJoined = async (roomData) => {
    console.log('Room data:', roomData);

    try {
      const response = await fetch(`${backendUrl}/room/${roomId}/content`, {
        method: 'GET',
        credentials: 'include',
      });
      const data = await response.json();

      if (response.ok && data.text && ydoc) {
        console.log('Fetched initial content from backend:', data.text.substring(0, 100));
        const ytext = ydoc.getText('shared-text');
        ytext.delete(0, ytext.length); // Clear existing content
        ytext.insert(0, data.text);   // Load content from backend
        setContentSynced(true);        // Mark content as synced
      }
    } catch (error) {
      console.error('Error fetching initial content:', error);
    }
  };

  socket.on('room_joined', handleRoomJoined);

  return () => {
    socket.off('room_joined');
  };
}, [ydoc, roomId, backendUrl]);

  // 1. Fetch and load initial content from backend into Yjs
useEffect(() => {
  const fetchInitialContent = async () => {
    try {
      const response = await fetch(`${backendUrl}/room/${roomId}/content`, {
        method: 'GET',
        credentials: 'include',
      });
      const data = await response.json();

      if (response.ok && data.text) {
        const ytext = ydoc.getText('shared-text');
        ytext.delete(0, ytext.length);
        ytext.insert(0, data.text);
        console.log('Initial content loaded from MongoDB');
      }
    } catch (error) {
      console.error('Error fetching initial content:', error);
    }
  };

  if (ydoc && roomId) {
    fetchInitialContent();
  }
}, [ydoc, roomId, backendUrl]);

  // 2. Handle Yjs document updates and save to backend
  useEffect(() => {
  if (!ydoc) return;

  const ytext = ydoc.getText('shared-text');

  const debouncedSave = debounce(async (content) => {
    try {
      await fetch(`${backendUrl}/room/${roomId}/content`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: content }),
        credentials: 'include',
      });
      console.log('Content saved to MongoDB');
    } catch (error) {
      console.error('Failed to save content to MongoDB:', error);
    }
  }, 2000);

  const observer = () => {
    const content = ytext.toString();
    debouncedSave(content);
  };

  ytext.observe(observer);

  return () => {
    ytext.unobserve(observer);
    debouncedSave.cancel();
  };
}, [ydoc, roomId, backendUrl]);
  // Remove the following useEffect as it's redundant and causes conflicts
  /*
  useEffect(() => {
    const debouncedSaveToMongo = debounce((roomName, ydoc) => {
      // ...
    }, 2000);

    ydoc.on('update', () => {
      debouncedSaveToMongo(roomName, ydoc);
    });
  }, []);
  */
useEffect(() => {
  const fetchContentWithRetry = async (retries = 3) => {
    try {
      const response = await fetch(`${backendUrl}/room/${roomId}/content`, { method: 'GET', credentials: 'include' });
      const data = await response.json();

      if (response.ok && data.text) {
        const ytext = ydoc.getText('shared-text');
        if (ytext.toString() !== data.text) {
          ytext.delete(0, ytext.length);
          ytext.insert(0, data.text);
          console.log('Content synced from backend after retry');
        }
      }
    } catch (error) {
      if (retries > 0) {
        console.error('Retrying content fetch...', error);
        await fetchContentWithRetry(retries - 1);
      } else {
        console.error('Failed to fetch content after retries:', error);
      }
    }
  };

  if (ydoc && isYjsSynced && !contentSyncedRef.current) {
    fetchContentWithRetry();
  }
}, [ydoc, isYjsSynced, roomId, backendUrl]);

  // Handle synchronization timeout
  useEffect(() => {
    if (loading) {
      const timer = setTimeout(() => {
        setSyncTimeout(true);
        setLoading(false);
      }, 10000);
      return () => clearTimeout(timer);
    }
  }, [loading]);

  // Handle Name Submission
  const handleNameSubmit = () => {
    if (userName.trim()) {
      console.log('Setting user name:', userName);
      localStorage.setItem('userName', userName);
      setIsNameSet(true);
    } else {
      alert('Please enter a valid name.');
    }
  };

  // Handle Download
  const handleDownload = () => {
    const content = ydoc.getText('shared-text').toString(); // Get content from Yjs document

    const languageFileExtensions = {
      javascript: 'js',
      python: 'py',
      cpp: 'cpp',
      php: 'php',
      markdown: 'md',
      json: 'json',
      text: 'txt'
    };

    const fileExtension = languageFileExtensions[selectedLanguage] || 'txt'; // Default to 'txt' if no match

    const blob = new Blob([content], { type: 'text/plain' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `syncrolly_content.${fileExtension}`; // Download with the dynamic file extension
    link.click();
  };

  // Handle Editable Toggle
  const handleEditableToggle = () => {
    if (!isCreator) return;
    socket.emit('toggle_editability', { roomId, userId: storedUserId }, (response) => {
      if (response.error) {
        alert(response.error);
      } else {
        console.log(`Editability toggled to ${response.isEditable}`);
        setIsEditable(response.isEditable); // Update local state based on response
        alert(`Room is now ${response.isEditable ? 'editable' : 'view-only'}.`);
      }
    });
  };

  // Handle Sending Messages
  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    socket.emit('send_message', { roomId, userId: storedUserId, message: chatInput });
    setChatInput('');
  };

  // Handle File Upload
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
        credentials: 'include',
      });

      const responseText = await response.text();
      try {
        const data = response.ok ? JSON.parse(responseText) : null;

        if (response.ok) {
          setFiles((prevFiles) => {
            if (!prevFiles.some((file) => file.fileUrl === data.fileUrl)) {
              return [...prevFiles, data];
            }
            return prevFiles;
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
      } catch (jsonError) {
        console.error('JSON parsing error:', jsonError);
        alert('Server response was not in JSON format. Raw response: ' + responseText);
      }
    } catch (error) {
      console.error('Upload error:', error);
      alert('File upload failed: ' + error.message);
    }
  };

  // Handle File Deletion
  const handleDeleteFile = async (fileId) => {
    try {
      const response = await fetch(`${backendUrl}/delete_file/${roomId}/${fileId}`, {
        method: 'DELETE',
        mode: 'cors',
        credentials: 'include',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const responseText = await response.text();
      console.log('Raw server response:', responseText);

      try {
        const data = response.ok ? JSON.parse(responseText) : null;

        if (response.ok) {
          alert('File deleted successfully');
          setFiles((prevFiles) => prevFiles.filter((file) => file._id !== fileId));
        } else {
          const errorData = JSON.parse(responseText);
          alert(errorData.error || 'Failed to delete file');
        }
      } catch (jsonError) {
        console.error('JSON parsing error:', jsonError);
        alert('Failed to delete file: ' + responseText);
      }
    } catch (error) {
      console.error('Error deleting file:', error);
      alert('Error deleting file: ' + error.message);
    }
  };

  // Toggle Theme
  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
  };

  // Toggle Chat Box
  const toggleChatBox = () => {
    setChatVisible(!chatVisible);
    if (!chatVisible) {
      setHasUnreadMessages(false);
    }
    console.log('Yjs Document Content:', ydoc.getText('shared-text').toString());
  };

  // Handle Typing Start
  const handleTypingStart = () => {
    if (!isTyping) {
      socket.emit('typing_start', { roomId, userId: storedUserId, userName });
      setIsTyping(true);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }

    typingTimeoutRef.current = setTimeout(() => {
      handleTypingStop();
    }, 3000);
  };

  // Handle Typing Stop
  const handleTypingStop = () => {
    if (isTyping) {
      socket.emit('typing_stop', { roomId, userId: storedUserId });
      setIsTyping(false);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  };

  // Editor Extensions
  const editorExtensions = useMemo(() => {
    const baseExtension = languageExtensions[selectedLanguage];
    return [
      baseExtension || markdown(), // Fallback to markdown if extension is undefined
      EditorView.lineWrapping,
      EditorView.editable.of(isEditable || isCreator),
      yCollab(ydoc.getText('shared-text'), awareness, {}),
    ];
  }, [isEditable, isCreator, awareness, selectedLanguage, languageExtensions, ydoc]);

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
                {isEditable ? "Set to View-Only" : "Make Editable"}
              </button>
            )}

            <div className={styles['chat-toggle']}>
              <button onClick={toggleChatBox} className={styles['chat-btn']} aria-label={chatVisible ? 'Close Chat' : 'Open Chat'}>
                {hasUnreadMessages && (
                  <span className={styles['notification-badge']} aria-label="New chat messages">New!</span>
                )}
                {chatVisible ? 'Close Chat' : 'Chat'}
              </button>
              <button onClick={() => setFilesModalVisible(true)} className={styles['files-btn']} aria-label="View Files">
                View Files
              </button>
              <button onClick={handleDownload} className={styles['download-btn']} aria-label="Download Content">
                Download
              </button>
            </div>

            <div className={styles['theme-toggle']}>
              <button onClick={toggleTheme} className={styles['theme-btn']} aria-label="Toggle Theme">
                {theme === 'light' ? (
                  <i className="fas fa-moon"></i>
                ) : (
                  <i className="fas fa-sun"></i>
                )}
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
  {connectionStatus !== 'connected' && (
    <div className={styles['connection-status']}>
      {connectionStatus === 'connecting' ? (
        <div className={styles['connecting-message']}>
          <p>Connecting to room... The server might be waking up.</p>
          <p>Please wait a moment.</p>
        </div>
      ) : connectionStatus === 'failed' ? (
        <div className={styles['failed-message']}>
          <p>Failed to connect to the room.</p>
          <button 
            onClick={() => window.location.reload()} 
            className={styles['retry-button']}
          >
            Retry Connection
          </button>
        </div>
      ) : null}
    </div>
  )}
  <CodeMirror
    extensions={editorExtensions}
    className={`${styles['code-editor']} ${styles[theme]}`}
    readOnly={!(isEditable || isCreator)}
    aria-label="Code Editor"
  />
            {!isYjsSynced && loading && (
              <div className={styles['yjs-loading-overlay']}>
                <p>
                  {syncTimeout ? 
                    "Synchronization is taking longer than usual. The editor will be available shortly." : 
                    "Synchronizing editor content..."}
                </p>
              </div>
            )}
          </div>

          <div className={styles['typing-indicator']}>
            {typingUsers.length > 0 && (
              <p>
                {typingUsers.map((user) => user.userName).join(', ')}{' '}
                {typingUsers.length > 1 ? 'are' : 'is'} typing...
              </p>
            )}
          </div>

          <div className={styles['refresh-note']}>
            <p><strong>Note:</strong> If you believe there should be content in this room but see nothing, try refreshing the page a couple of times.</p>
          </div>

          <div className={`${styles['chat-box']} ${chatVisible ? styles['open'] : ''} ${styles[theme]}`}>
            <button onClick={toggleChatBox} className={styles['close-btn']} aria-label="Close Chat">
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
            <button onClick={handleSendMessage} className={styles['send-btn']} aria-label="Send Message">
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
