// frontend/src/contexts/YjsContext.jsx
import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const YjsContext = createContext();

export const YjsProvider = ({ children, roomId }) => {
  // Create a single Y.Doc per mount
  const ydoc = useMemo(() => new Y.Doc(), []);

  const [provider, setProvider] = useState(null);
  const [awareness, setAwareness] = useState(null);
  const [isYjsSynced, setIsYjsSynced] = useState(false);

  useEffect(() => {
    // Connect to your Yjs WebSocket server
    if (roomId) {
      const wsUrl = process.env.REACT_APP_YJS_WS_URL || 'ws://localhost:1234';
      const newProvider = new WebsocketProvider(wsUrl, roomId, ydoc);
      setProvider(newProvider);
      setAwareness(newProvider.awareness);

      newProvider.on('status', (event) => {
        console.log(`Yjs WebsocketProvider status: ${event.status}`);
        setIsYjsSynced(event.status === 'connected');
      });

      newProvider.on('connection-error', (error) => {
        console.error('Yjs WebsocketProvider connection error:', error);
      });

      newProvider.on('reconnect', () => {
        console.log('Yjs WebsocketProvider attempting to reconnect...');
      });

      return () => {
        newProvider.destroy();
        setProvider(null);
        setAwareness(null);
        setIsYjsSynced(false);
        console.log('Yjs WebsocketProvider disconnected');
      };
    }
  }, [roomId, ydoc]);

  return (
    <YjsContext.Provider value={{ ydoc, provider, awareness, isYjsSynced }}>
      {children}
    </YjsContext.Provider>
  );
};

export const useYjs = () => {
  return useContext(YjsContext);
};
