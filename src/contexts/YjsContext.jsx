import React, { createContext, useContext, useMemo, useState, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const YjsContext = createContext();

// Keep track of existing documents across provider instances
const documentsMap = new Map();

export const YjsProvider = ({ children, roomId }) => {
  // Only create a new Y.Doc if one doesn't exist for this room
  const ydoc = useMemo(() => {
    if (documentsMap.has(roomId)) {
      console.log(`Reusing existing Y.Doc for room ${roomId}`);
      return documentsMap.get(roomId);
    }
    const newDoc = new Y.Doc();
    documentsMap.set(roomId, newDoc);
    console.log(`Created new Y.Doc for room ${roomId}`);
    return newDoc;
  }, [roomId]);

  const [provider, setProvider] = useState(null);
  const [awareness, setAwareness] = useState(null);
  const [isYjsSynced, setIsYjsSynced] = useState(false);
  const providerRef = useRef(null);

  useEffect(() => {
    if (!roomId) return;

    // Cleanup previous provider if it exists
    if (providerRef.current) {
      providerRef.current.destroy();
      console.log('Cleaned up previous provider');
    }

    const wsUrl = process.env.REACT_APP_YJS_WS_URL || 'ws://localhost:1234';
    const newProvider = new WebsocketProvider(wsUrl, roomId, ydoc);
    providerRef.current = newProvider;

    newProvider.on('status', (event) => {
      console.log(`Yjs WebsocketProvider status: ${event.status}`);
      setIsYjsSynced(event.status === 'connected');
    });

    newProvider.on('connection-error', (error) => {
      console.error('Yjs WebsocketProvider connection error:', error);
      setIsYjsSynced(false);
    });

    newProvider.on('sync', (isSynced) => {
      console.log('Sync status:', isSynced);
      if (isSynced) {
        setIsYjsSynced(true);
      }
    });

    setProvider(newProvider);
    setAwareness(newProvider.awareness);

    return () => {
      newProvider.destroy();
      setProvider(null);
      setAwareness(null);
      setIsYjsSynced(false);
      console.log('Yjs WebsocketProvider disconnected');
    };
  }, [roomId, ydoc]);

  // Cleanup document when component unmounts and no other providers are using it
  useEffect(() => {
    return () => {
      if (roomId && documentsMap.has(roomId)) {
        const doc = documentsMap.get(roomId);
        // Only destroy if this is the last provider using the document
        const remainingProviders = Array.from(doc.getSubdocs()).length;
        if (remainingProviders === 0) {
          doc.destroy();
          documentsMap.delete(roomId);
          console.log(`Destroyed Y.Doc for room ${roomId}`);
        }
      }
    };
  }, [roomId]);

  return (
    <YjsContext.Provider value={{ 
      ydoc, 
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
