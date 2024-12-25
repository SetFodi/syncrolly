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
import { debounce } from 'lodash';
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
  const [messages, setMessages] = useState([]);
  const [chatVisible, setChatVisible] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [theme, setTheme] = useState(storedTheme);
  const [typingUsers, setTypingUsers] = useState([]);
  const [files, setFiles] = useState([]);
  const [fileInput, setFileInput] = useState(null);
  const [isEditable, setIsEditable] = useState(false);
  const [loading, setLoading] = useState(isNameSet);
  const [isCodeMode, setIsCodeMode] = useState(true); // Default to code mode
  const [hasUnreadMessages, setHasUnreadMessages] = useState(false); // New state for chat notifications
  const typingTimeoutRef = useRef(null);
  const [isTyping, setIsTyping] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState("javascript"); // Updated initial value
  const [showReminder, setShowReminder] = useState(false);

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

  // Access Yjs context
  const { ydoc, awareness, isYjsSynced } = useYjs();

  // Initialize Socket.IO Events
useEffect(() => {
  if (isNameSet) {
    setLoading(true);
    console.log('Attempting to join room with:', { roomId, userName: storedUserName, userId: storedUserId, isCreator });

    socket.emit('join_room', { roomId, userName: storedUserName, userId: storedUserId, isCreator }, (response) => {
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
        setIsCodeMode(response.editorMode === 'code');
        console.log('Initial isEditable state:', response.isEditable);
        console.log('Initial editor mode:', response.editorMode);
        setLoading(false);
      }
    });

    socket.on('room_deleted', ({ message, deleteAfter }) => {
      if (deleteAfter && new Date() > new Date(deleteAfter)) {
        alert(message);
        // You can also clear the content here if you want to sync with the deletion
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
      socket.off('editor_mode_changed');
      socket.off('editable_state_changed');
      socket.off('theme_changed');
      socket.off('room_deleted');
    };
  }
}, [isNameSet, roomId, storedUserName, storedUserId, isCreator, navigate, chatVisible]);

// Add a new effect to handle text content saving
useEffect(() => {
  if (isNameSet && ydoc) {
    // Set up observer for Yjs text changes
    const observer = () => {
      const currentText = ydoc.getText('shared-text').toString();
      socket.emit('save_text_content', { 
        roomId,
        text: currentText
      });
    };

    // Observe text changes with debouncing
    const debouncedObserver = debounce(observer, 1000);
    ydoc.getText('shared-text').observe(debouncedObserver);

    return () => {
      // Clean up observer
      ydoc.getText('shared-text').unobserve(debouncedObserver);
    };
  }
}, [isNameSet, ydoc, roomId]);

  
useEffect(() => {
  socket.on('room_joined', (roomData) => {
    console.log('Room data:', roomData);
    if (roomData.text && ydoc) {
      // Clear existing content first
      const yText = ydoc.getText('shared-text');
      yText.delete(0, yText.length);
      // Insert the saved text
      if (roomData.text.length > 0) {
        yText.insert(0, roomData.text);
      }
    }
  });

  return () => {
    socket.off('room_joined');
  };
}, [ydoc]);

useEffect(() => {
  return () => {
    if (ydoc) {
      const finalText = ydoc.getText('shared-text').toString();
      socket.emit('send_editor_content', {
        roomId,
        userId: storedUserId,
        currentText: finalText
      });
    }
  };
}, [ydoc, roomId, storedUserId]);  


  // Handle Awareness State
  useEffect(() => {
    if (isNameSet && awareness) {
      awareness.setLocalStateField('user', {
        id: storedUserId,
        name: userName,
        color: '#' + Math.floor(Math.random()*16777215).toString(16),
      });

      const onAwarenessChange = () => {
        const states = Array.from(awareness.getStates().values());
        setTypingUsers(
          states.map((state) => ({
            userId: state.user.id,
            userName: state.user.name,
            color: state.user.color,
          }))
        );
      };

      awareness.on('change', onAwarenessChange);

      return () => {
        awareness.off('change', onAwarenessChange);
      };
    }
  }, [isNameSet, userName, awareness, storedUserId]);

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
    // Determine the file content based on the editor mode
    const content = ydoc.getText('shared-text').toString(); // Get content from Yjs document

    // Map language to file extension
    const languageFileExtensions = {
      javascript: 'js',
      python: 'py',
      cpp: 'cpp',
      php: 'php',
      markdown: 'md',
      json: 'json',
      text: 'txt'
    };

    // Get the selected language from your editor's state
    const fileExtension = languageFileExtensions[selectedLanguage] || 'txt'; // Default to 'txt' if no match

    // Create a Blob object with the content
    const blob = new Blob([content], { type: 'text/plain' });

    // Create a link element and trigger the download
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `syncrolly_content.${fileExtension}`; // Download with the dynamic file extension based on selectedLanguage
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
      }
    });
  };

  // Handle Editor Mode Toggle
  const handleToggleEditorMode = () => {
    socket.emit('toggle_editor_mode', { roomId, userId: storedUserId }, (response) => {
      if (response.error) {
        alert(response.error);
      } else if (response.success) {
        console.log(`Editor mode toggled to ${response.editorMode}`);
        if (response.editorMode === 'text') {
          setShowReminder(true);  // Show the reminder when switching to text editor mode
        } else {
          setShowReminder(false);  // Hide the reminder when switching back to code editor mode
        }
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
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/upload/${roomId}`, {
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
      const response = await fetch(`${process.env.REACT_APP_BACKEND_URL}/delete_file/${roomId}/${fileId}`, {
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
// Editor Extensions
const editorExtensions = useMemo(() => {
  const baseExtension = isCodeMode ? languageExtensions[selectedLanguage] : markdown();
  return [
    baseExtension || markdown(), // Fallback to markdown if extension is undefined
    EditorView.lineWrapping,
    EditorView.editable.of(isEditable || isCreator),
    yCollab(ydoc.getText('shared-text'), awareness, {}),
  ];
}, [isEditable, isCreator, isCodeMode, awareness, selectedLanguage, languageExtensions, ydoc]);


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

            {isCreator && (
              <div className={styles['editor-toggle']}>
                <button onClick={handleToggleEditorMode} className={styles['toggle-editor-btn']} aria-label="Toggle Editor Mode">
                  {isCodeMode ? 'Switch to Text Editor' : 'Switch to Code Editor'}
                </button>
              </div>
            )}

            {/* Language Selector after the editor-toggle */}
            {isCodeMode && (
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
            )}

            <div className={styles['current-editor-mode']}>
              <p>
                Current Editor Mode: <strong>{isCodeMode ? 'Code Editor' : 'Plain Text Editor'}</strong>
              </p>
            </div>
          </div>

          <div className={styles['main-content']}>
            <CodeMirror
              extensions={editorExtensions}
              className={`${styles['code-editor']} ${styles[theme]}`}
              readOnly={!(isEditable || isCreator)}
              aria-label="Code Editor"
            />
            {!isYjsSynced && (
              <div className={styles['yjs-loading-overlay']}>
                <p>Synchronizing editor content...</p>
              </div>
            )}
          </div>

          {showReminder && (
            <div className={styles['editor-reminder']}>
              <p><strong>Reminder:</strong> Please type one by one when using the text editor.</p>
            </div>
          )}

          <div className={styles['typing-indicator']}>
            {typingUsers.length > 0 && (
              <p>
                {typingUsers.map((user) => user.userName).join(', ')}{' '}
                {typingUsers.length > 1 ? 'are' : 'is'} typing...
              </p>
            )}
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
