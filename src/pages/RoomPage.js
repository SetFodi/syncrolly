// frontend/src/pages/RoomPage.jsx

import React, { useState, useEffect, useMemo, useRef } from 'react';
import { useParams, useLocation, Link, useNavigate } from 'react-router-dom';
import { v4 as uuidv4 } from 'uuid';
import socket from '../socket'; // Ensure socket.io-client is correctly set up
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { markdown } from '@codemirror/lang-markdown';
import { EditorView } from '@codemirror/view';
import debounce from 'lodash.debounce';
import styles from './RoomPage.module.css';
import FilesModal from './FilesModal';
import '@fortawesome/fontawesome-free/css/all.min.css';
import * as Y from 'yjs'; // Import Yjs
import { WebsocketProvider } from 'y-websocket'; // Yjs WebSocket Provider
import { yCollab } from 'y-codemirror.next'; // Yjs extension for CodeMirror

import { python } from '@codemirror/lang-python';
import { cpp } from '@codemirror/lang-cpp';
import { php } from '@codemirror/lang-php';

function RoomPage() {
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

  const backendUrl = process.env.REACT_APP_BACKEND_URL;
  console.log('Backend URL:', backendUrl);

  // Language handling
  const [currentLanguage, setCurrentLanguage] = useState('javascript');

  const languageExtensions = useMemo(() => ({
    javascript: javascript(),
    python: python(),
    cpp: cpp(),
    php: php(),
    markdown: markdown()
  }), []);

  // Initialize Yjs document
  const ydoc = useMemo(() => new Y.Doc(), []);

  // Initialize a single Y.Text instance
  const yText = useMemo(() => ydoc.getText('shared-text'), [ydoc]);

  // Initialize WebsocketProvider and Awareness
  const [provider, setProvider] = useState(null);
  const [awareness, setAwareness] = useState(null);

  useEffect(() => {
    if (isNameSet) {
      const wsUrl = process.env.REACT_APP_YJS_WS_URL || 'ws://localhost:1234';
      const newProvider = new WebsocketProvider(wsUrl, roomId, ydoc);
      setProvider(newProvider);
      setAwareness(newProvider.awareness);
      console.log('Connected to Yjs WebsocketProvider');

      newProvider.on('status', event => {
        console.log(`WebsocketProvider status: ${event.status}`);
      });

      return () => {
        newProvider.destroy();
        setAwareness(null);
        console.log('Disconnected from Yjs WebsocketProvider');
      };
    }
  }, [isNameSet, roomId, ydoc]);

  useEffect(() => {
    if (!isNameSet) {
      setLoading(false);
    }
  }, [isNameSet]);

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

      socket.on('new_file', (newFile) => {
        setFiles((prevFiles) => [...prevFiles, newFile]);
      });

      socket.on('receive_message', (message) => {
        setMessages((prev) => [...prev, message]);
        if (!chatVisible) {
          setHasUnreadMessages(true);
        }
      });

      socket.on('user_typing', (data) => {
        setTypingUsers((prev) => {
          const userExists = prev.some((user) => user.userId === data.userId);
          if (userExists) {
            return prev;
          }
          return [...prev, data];
        });
      });

      socket.on('user_stopped_typing', (data) => {
        setTypingUsers((prev) => prev.filter((user) => user.userId !== data.userId));
      });

      socket.on('editor_mode_changed', ({ editorMode }) => {
        console.log('Editor mode changed to:', editorMode);
        setIsCodeMode(editorMode === 'code');
      });

      socket.on('editable_state_changed', ({ isEditable: newIsEditable }) => {
        console.log('Editable state changed:', newIsEditable);
        setIsEditable(newIsEditable);
      });

      socket.on('theme_changed', (newTheme) => {
        setTheme(newTheme);
      });

      socket.on('room_deleted', ({ message }) => {
        alert(message);
        navigate('/');
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
  }, [
    isNameSet,
    roomId,
    storedUserName,
    storedUserId,
    isCreator,
    navigate,
    chatVisible,
    yText
  ]);

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

  useEffect(() => {
    if (isNameSet) {
      const handleYjsUpdate = () => {
        // Additional logic if needed
      };
      ydoc.on('update', handleYjsUpdate);

      return () => {
        ydoc.off('update', handleYjsUpdate);
      };
    }
  }, [isNameSet, ydoc]);

  const handleNameSubmit = () => {
    if (userName.trim()) {
      console.log('Setting user name:', userName);
      localStorage.setItem('userName', userName);
      setIsNameSet(true);
    } else {
      alert('Please enter a valid name.');
    }
  };

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

  const handleToggleEditorMode = () => {
    socket.emit('toggle_editor_mode', { roomId, userId: storedUserId }, (response) => {
      if (response.error) {
        alert(response.error);
      } else if (response.success) {
        console.log(`Editor mode toggled to ${response.editorMode}`);
      }
    });
  };

  const handleSendMessage = () => {
    if (!chatInput.trim()) return;
    socket.emit('send_message', { roomId, userId: storedUserId, message: chatInput });
    setChatInput('');
  };

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


  const toggleTheme = () => {
    const newTheme = theme === 'light' ? 'dark' : 'light';
    setTheme(newTheme);
    localStorage.setItem('theme', newTheme);
    socket.emit('change_theme', { roomId, theme: newTheme });
  };

  const toggleChatBox = () => {
    setChatVisible(!chatVisible);
    if (!chatVisible) {
      setHasUnreadMessages(false);
    }
    console.log('yText when chat is toggled:', yText.toString());
  };

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

  const handleTypingStop = () => {
    if (isTyping) {
      socket.emit('typing_stop', { roomId, userId: storedUserId });
      setIsTyping(false);
    }

    if (typingTimeoutRef.current) {
      clearTimeout(typingTimeoutRef.current);
    }
  };

  const editorExtensions = useMemo(() => {
    const baseExtension = isCodeMode ? languageExtensions[currentLanguage] : markdown();
    return [
      baseExtension,
      EditorView.lineWrapping,
      EditorView.editable.of(isEditable || isCreator),
      yCollab(yText, awareness, {}),
    ];
  }, [isEditable, isCreator, isCodeMode, yText, awareness, currentLanguage, languageExtensions]);

  const debouncedUpdateYjs = useMemo(() => debounce((value) => {
    if (value !== yText.toString()) {
      ydoc.transact(() => {
        yText.delete(0, yText.length);
        yText.insert(0, value);
      });
    }
  }, 300), [yText, ydoc]);

  useEffect(() => {
    return () => {
      debouncedUpdateYjs.cancel();
    };
  }, [debouncedUpdateYjs]);

  const [plainText, setPlainText] = useState(yText.toString());

  useEffect(() => {
    setPlainText(yText.toString());
    console.log('Initial yText:', yText.toString());

    const updateHandler = () => {
      setPlainText(yText.toString());
      console.log('yText updated:', yText.toString());
    };

    yText.observe(updateHandler);
    return () => {
      yText.unobserve(updateHandler);
    };
  }, [yText]);

  const handlePlainTextChange = (e) => {
    const newValue = e.target.value;
    setPlainText(newValue);
    handleTypingStart();
    debouncedUpdateYjs(newValue);
  };

  return loading ? (
    <div className={styles['loading-container']}>
      <div className={styles['spinner']}></div>
      <p>Loading...</p>
    </div>
  ) : (
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
                className={`${styles['toggle-btn']} ${isEditable ? 'editable' : 'viewOnly'}`}
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
              <button onClick={() => setFilesModalVisible(true)} className={styles['files-btn']}>
                View Files
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
                <button onClick={handleToggleEditorMode} className={styles['toggle-editor-btn']}>
                  {isCodeMode ? 'Switch to Text Editor' : 'Switch to Code Editor'}
                </button>
              </div>
            )}

            {/* Language Selector after the editor-toggle */}
            {isCodeMode && (
              <div className={styles['language-select']}>
                <label htmlFor="language-select" style={{ marginRight: '8px' }}>Language:</label>
                <select
                  id="language-select"
                  value={currentLanguage}
                  onChange={(e) => setCurrentLanguage(e.target.value)}
                >
                  <option value="javascript">JavaScript</option>
                  <option value="python">Python</option>
                  <option value="cpp">C/C++</option>
                  <option value="php">PHP</option>
                  <option value="markdown">Markdown</option>
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
            {isCodeMode ? (
              <CodeMirror
                value={plainText}
                extensions={editorExtensions}
                className={`${styles['code-editor']} ${styles[theme]}`}
                readOnly={!(isEditable || isCreator)}
              />
            ) : (
              <textarea
                value={plainText}
                onChange={handlePlainTextChange}
                onBlur={handleTypingStop}
                className={`${styles['text-editor']} ${styles[theme]}`}
                placeholder="Start typing..."
                disabled={!isEditable && !isCreator}
                onFocus={handleTypingStart}
              />
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

          <div className={`${styles['chat-box']} ${chatVisible ? styles['open'] : ''} ${styles[theme]}`}>
            <button onClick={toggleChatBox} className={styles['close-btn']}>
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
            />
            <button onClick={handleSendMessage} className={styles['send-btn']}>
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

export default RoomPage;
