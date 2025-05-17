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
import LoadingScreen from '../components/LoadingScreen';
import UserPresence from '../components/UserPresence';
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
  const [roomUsers, setRoomUsers] = useState({});
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

  // Initialize Socket.IO Events with enhanced reliability
  useEffect(() => {
    if (isNameSet && ydoc) {
      setLoading(true);
      setConnectionStatus('connecting');
      console.log('Attempting to join room with:', { roomId, userName: storedUserName, userId: storedUserId, isCreator });

      // Track connection attempts for analytics
      const connectionStartTime = Date.now();

      const joinRoom = async () => {
        // Increase max attempts and initial delay for better reliability
        const result = await retryWithTimeout(
          () => new Promise((resolve, reject) => {
            // Set a timeout for the socket.emit operation
            const timeoutId = setTimeout(() => {
              reject(new Error('Socket.io connection timeout'));
            }, 10000); // 10 second timeout

            socket.emit('join_room',
              {
                roomId,
                userName: storedUserName,
                userId: storedUserId,
                isCreator,
                clientTimestamp: new Date().toISOString() // Add timestamp for debugging
              },
              (response) => {
                clearTimeout(timeoutId); // Clear the timeout when we get a response

                if (response.error) {
                  console.error('Room join error:', response.error);
                  reject(new Error(response.error));
                } else {
                  resolve(response);
                }
              }
            );
          }),
          7, // Increased max attempts
          1500 // Increased initial delay
        );

        if (result.success) {
          const connectionTime = Date.now() - connectionStartTime;
          console.log(`Joined room successfully in ${connectionTime}ms:`, result.data);

          // Update all room state from server response
          setFiles(result.data.files || []);
          setMessages(result.data.messages || []);
          setIsEditable(result.data.isEditable !== false); // Default to true if undefined
          setIsCreator(result.data.isCreator === true);

          // Set room users
          if (result.data.users) {
            setRoomUsers(result.data.users);
          }

          // If server provides a theme, use it
          if (result.data.theme) {
            setTheme(result.data.theme);
            localStorage.setItem('theme', result.data.theme);
          }

          // If server provides a language, use it
          if (result.data.editorMode) {
            setSelectedLanguage(result.data.editorMode);
          }

          setConnectionStatus('connected');

          // Log connection success with details
          console.log('Socket.io connection established, waiting for Yjs sync...');
          console.log('Room details:', {
            roomId,
            isCreator: result.data.isCreator,
            isEditable: result.data.isEditable,
            userCount: Object.keys(result.data.users || {}).length,
            messageCount: (result.data.messages || []).length,
            fileCount: (result.data.files || []).length,
            createdAt: result.data.roomCreatedAt
          });
        } else {
          setConnectionStatus('failed');
          setLoading(false);
          setRetryCount(prev => prev + 1);
          console.error('Failed to join room:', result.error);

          // More helpful error message
          alert(`Failed to connect to the room. The server might be waking up or experiencing issues. Please try again in a moment. (Attempt ${retryCount + 1})`);
        }
      };

      // Add connection error handler
      const handleConnectionError = (error) => {
        console.error('Socket connection error:', error);
        setConnectionStatus('failed');
        setLoading(false);
      };

      socket.on('connect_error', handleConnectionError);
      socket.on('connect_timeout', handleConnectionError);

      // Attempt to join the room
      joinRoom();

      // All the socket event listeners remain unchanged
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

      // Listen for user joined events
      socket.on('user_joined', ({ userId, userName }) => {
        console.log(`User joined: ${userName} (${userId})`);
        setRoomUsers(prevUsers => ({
          ...prevUsers,
          [userId]: userName
        }));
      });

      // Listen for user left events
      socket.on('user_left', ({ userId }) => {
        console.log(`User left: ${userId}`);
        setRoomUsers(prevUsers => {
          const newUsers = { ...prevUsers };
          delete newUsers[userId];
          return newUsers;
        });
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
        socket.off('user_joined');
        socket.off('user_left');
        socket.off('editable_state_changed');
        socket.off('theme_changed');
        socket.off('room_deleted');
        socket.off('room_joined');
        socket.off('content_update');
      };
    }
  }, [isNameSet, roomId, storedUserName, storedUserId, isCreator, navigate, chatVisible, ydoc]);

  // NEW SEPARATE EFFECT: Check if both systems are ready
  useEffect(() => {
    // Only run this check when we're trying to connect
    if (isNameSet && ydoc && loading) {
      // Add this logging to debug connection status
      console.log('Connection status check - Socket connected:', connectionStatus === 'connected');
      console.log('Connection status check - Yjs synced:', isYjsSynced);

      // When both are ready, set loading to false
      if (connectionStatus === 'connected' && isYjsSynced) {
        setLoading(false);
        console.log('All systems ready! Both socket.io and Yjs are connected.');
      }
    }
  }, [isNameSet, connectionStatus, isYjsSynced, ydoc, loading]);
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

  // Enhanced content synchronization between Yjs and MongoDB
  useEffect(() => {
    if (!ydoc) return;

    const ytext = ydoc.getText('shared-text');
    let lastSavedContent = ytext.toString();
    let saveInProgress = false;
    let pendingSave = false;

    // Track save operations for analytics
    let saveSuccessCount = 0;
    let saveFailureCount = 0;

    // Enhanced save function with retry logic
    const saveContentToMongo = async (content) => {
      if (saveInProgress) {
        pendingSave = true;
        return;
      }

      saveInProgress = true;
      let retryCount = 0;
      const maxRetries = 5;

      while (retryCount < maxRetries) {
        try {
          console.log(`Saving content to MongoDB (${content.length} chars), attempt ${retryCount + 1}/${maxRetries}`);

          const response = await fetch(`${backendUrl}/room/${roomId}/content`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              text: content,
              clientTimestamp: new Date().toISOString(),
              userId: storedUserId
            }),
            credentials: 'include',
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`Server returned ${response.status}: ${errorText}`);
          }

          lastSavedContent = content;
          saveSuccessCount++;
          console.log(`Content saved to MongoDB successfully (${content.length} chars)`);
          break; // Success, exit the retry loop
        } catch (error) {
          retryCount++;
          saveFailureCount++;
          console.error(`Failed to save content to MongoDB (attempt ${retryCount}/${maxRetries}):`, error);

          if (retryCount >= maxRetries) {
            console.error('Max retries reached, giving up on this save operation');
            break;
          }

          // Exponential backoff with jitter
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1) + Math.random() * 1000, 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }

      saveInProgress = false;

      // If another save was requested while this one was in progress, process it now
      if (pendingSave) {
        pendingSave = false;
        const currentContent = ytext.toString();
        if (currentContent !== lastSavedContent) {
          saveContentToMongo(currentContent);
        }
      }
    };

    // Debounced save to reduce frequency of saves during rapid typing
    const debouncedSave = debounce((content) => {
      if (content !== lastSavedContent) {
        saveContentToMongo(content);
      }
    }, 2000);

    // Observer for Yjs text changes
    const observer = () => {
      const content = ytext.toString();
      debouncedSave(content);
    };

    // Set up the observer
    ytext.observe(observer);

    // Log analytics periodically
    const analyticsInterval = setInterval(() => {
      if (saveSuccessCount > 0 || saveFailureCount > 0) {
        console.log(`Content sync analytics - Success: ${saveSuccessCount}, Failures: ${saveFailureCount}`);
      }
    }, 60000); // Log every minute

    // Cleanup function
    return () => {
      ytext.unobserve(observer);
      debouncedSave.cancel();
      clearInterval(analyticsInterval);

      // Final save on unmount if needed
      const finalContent = ytext.toString();
      if (finalContent !== lastSavedContent && !saveInProgress) {
        console.log('Performing final save before unmount');
        saveContentToMongo(finalContent);
      }
    };
  }, [ydoc, roomId, backendUrl, storedUserId]);

  // Enhanced content fetching with improved retry logic
  useEffect(() => {
    if (!ydoc || !isYjsSynced || contentSyncedRef.current) return;

    contentSyncedRef.current = true; // Set this immediately to prevent multiple fetches

    const fetchContentWithRetry = async () => {
      const maxRetries = 5;
      let retryCount = 0;
      let success = false;

      while (!success && retryCount < maxRetries) {
        try {
          console.log(`Fetching content from backend, attempt ${retryCount + 1}/${maxRetries}`);

          const response = await fetch(`${backendUrl}/room/${roomId}/content`, {
            method: 'GET',
            credentials: 'include',
            headers: {
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            }
          });

          if (!response.ok) {
            throw new Error(`Server returned status ${response.status}`);
          }

          const data = await response.json();

          if (data && typeof data.text === 'string') {
            const ytext = ydoc.getText('shared-text');
            const currentText = ytext.toString();

            // Only update if the content is different
            if (currentText !== data.text) {
              console.log(`Syncing content from backend (${data.text.length} chars)`);

              // Use a transaction to make this atomic
              ydoc.transact(() => {
                ytext.delete(0, ytext.length);
                ytext.insert(0, data.text);
              });

              console.log('Content synced from backend successfully');
            } else {
              console.log('Content already in sync with backend');
            }

            success = true;
          } else {
            console.log('No content received from backend or invalid format');
            success = true; // Consider this a success to avoid retrying
          }
        } catch (error) {
          retryCount++;
          console.error(`Error fetching content (attempt ${retryCount}/${maxRetries}):`, error);

          if (retryCount >= maxRetries) {
            console.error('Max retries reached, giving up on content fetch');
            break;
          }

          // Exponential backoff with jitter
          const delay = Math.min(1000 * Math.pow(2, retryCount - 1) + Math.random() * 1000, 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    };

    fetchContentWithRetry();
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
        // Parse response if needed
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

  // Editor Extensions with improved cursor awareness
  const editorExtensions = useMemo(() => {
    const baseExtension = languageExtensions[selectedLanguage];

    // Set up user awareness data with proper name
    if (awareness && storedUserName) {
      // Update the local user's metadata for cursor awareness
      awareness.setLocalStateField('user', {
        name: storedUserName,
        color: getRandomColor(storedUserId), // Generate a consistent color based on user ID
        userId: storedUserId
      });
    }

    return [
      baseExtension || markdown(), // Fallback to markdown if extension is undefined
      EditorView.lineWrapping,
      EditorView.editable.of(isEditable || isCreator),
      yCollab(ydoc.getText('shared-text'), awareness, {
        // Configure cursor appearance
        cursorBuilder: (user) => {
          // Use the user's name from awareness data
          const userName = user?.name || 'Anonymous';
          const userColor = user?.color || '#3182ce';

          // Create cursor element with user name
          const cursor = document.createElement('span');
          cursor.classList.add(styles.remoteCursor);
          cursor.style.borderLeftColor = userColor;

          // Create the tooltip with user name
          const tooltip = document.createElement('div');
          tooltip.classList.add(styles.cursorTooltip);
          tooltip.textContent = userName;
          tooltip.style.backgroundColor = userColor;

          cursor.appendChild(tooltip);
          return cursor;
        }
      }),
    ];
  }, [isEditable, isCreator, awareness, selectedLanguage, languageExtensions, ydoc, storedUserName, storedUserId]);

  // Helper function to generate a consistent color based on user ID
  const getRandomColor = (userId) => {
    // Generate a hash from the userId string
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }

    // Convert the hash to a color
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 60%)`;
  };

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
        {/* Enhanced LoadingScreen with more information */}
    {(connectionStatus !== 'connected' || !isYjsSynced) && (
      <LoadingScreen
        connectionStatus={connectionStatus}
        syncTimeout={syncTimeout}
        retryCount={retryCount}
      />
    )}
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
  {/* Connection status is now handled by the LoadingScreen component */}
  <CodeMirror
    extensions={editorExtensions}
    className={`${styles['code-editor']} ${styles[theme]}`}
    readOnly={!(isEditable || isCreator)}
    aria-label="Code Editor"
  />
          </div>

          <div className={styles['typing-indicator']}>
            {typingUsers.length > 0 && (
              <p>
                {typingUsers.map((user) => user.userName).join(', ')}{' '}
                {typingUsers.length > 1 ? 'are' : 'is'} typing...
              </p>
            )}
          </div>

          {/* User Presence Component */}
          <UserPresence users={roomUsers} currentUserId={storedUserId} />

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
