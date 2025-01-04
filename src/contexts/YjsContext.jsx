import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const YjsContext = createContext();

export const YjsProvider = ({ children, roomId }) => {
  // Use useRef for ydoc to maintain the same instance across re-renders
  const ydocRef = useRef(null);
  const [provider, setProvider] = useState(null);
  const [awareness, setAwareness] = useState(null);
  const [isYjsSynced, setIsYjsSynced] = useState(false);
  const providerRef = useRef(null);

  useEffect(() => {
    if (!roomId) return;

    // Only create a new Y.Doc if one doesn't exist
    if (!ydocRef.current) {
      ydocRef.current = new Y.Doc();
      console.log('Created new Y.Doc instance');
    }

    // Clean up previous provider if it exists
    if (providerRef.current) {
      providerRef.current.destroy();
      console.log('Cleaned up previous provider');
    }

    const wsUrl = process.env.REACT_APP_YJS_WS_URL || 'ws://localhost:1234';
    const newProvider = new WebsocketProvider(wsUrl, roomId, ydocRef.current, {
      connect: true,
      awareness: {
        timeout: 30000, // 30 seconds before inactive users are removed
      },
      params: {}, // Additional connection parameters if needed
    });

    providerRef.current = newProvider;
    setProvider(newProvider);
    setAwareness(newProvider.awareness);

    // Set up connection status handlers
    const handleStatus = (event) => {
      console.log(`Yjs WebsocketProvider status: ${event.status}`);
      setIsYjsSynced(event.status === 'connected');
    };

    const handleSync = (isSynced) => {
      console.log('Sync status:', isSynced);
      setIsYjsSynced(true);
    };

    const handleError = (error) => {
      console.error('Yjs WebsocketProvider connection error:', error);
      setIsYjsSynced(false);
    };

    newProvider.on('status', handleStatus);
    newProvider.on('sync', handleSync);
    newProvider.on('connection-error', handleError);
    newProvider.on('reconnect', () => {
      console.log('Yjs WebsocketProvider attempting to reconnect...');
    });

    return () => {
      newProvider.off('status', handleStatus);
      newProvider.off('sync', handleSync);
      newProvider.off('connection-error', handleError);
      newProvider.destroy();
      setProvider(null);
      setAwareness(null);
      setIsYjsSynced(false);
      console.log('Yjs WebsocketProvider disconnected');
    };
  }, [roomId]);

  // When component unmounts, destroy the Y.Doc instance
  useEffect(() => {
    return () => {
      if (ydocRef.current) {
        ydocRef.current.destroy();
        ydocRef.current = null;
        console.log('Destroyed Y.Doc instance');
      }
    };
  }, []);

  return (
    <YjsContext.Provider value={{ 
      ydoc: ydocRef.current, 
      provider, 
      awareness, 
      isYjsSynced 
    }}>
      {children}
    </YjsContext.Provider>
  );
};

export const useYjs = () => {
  const context = useContext(YjsContext);
  if (!context) {
    throw new Error('useYjs must be used within a YjsProvider');
  }
  return context;
};
