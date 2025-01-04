import React, { createContext, useContext, useMemo, useState, useEffect, useRef } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

const YjsContext = createContext();

// Keep track of existing documents across provider instances
const documentsMap = new Map();

export const YjsProvider = ({ children, roomId }) => {
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
  const initialSyncCompleted = useRef(false);

  useEffect(() => {
    if (!roomId) return;

    if (providerRef.current) {
      providerRef.current.destroy();
      console.log('Cleaned up previous provider');
    }

    const wsUrl = process.env.REACT_APP_YJS_WS_URL || 'ws://localhost:1234';
    const newProvider = new WebsocketProvider(wsUrl, roomId, ydoc, {
      connect: true,
      awareness: {
        timeout: 30000,
      },
      params: {}
    });
    providerRef.current = newProvider;

    const handleSync = (isSynced) => {
      console.log('Sync status:', isSynced);
      if (isSynced && !initialSyncCompleted.current) {
        initialSyncCompleted.current = true;
        setIsYjsSynced(true);
      }
    };

    const handleStatus = (event) => {
      console.log(`Yjs WebsocketProvider status: ${event.status}`);
      setIsYjsSynced(event.status === 'connected');
    };

    const handleError = (error) => {
      console.error('Yjs WebsocketProvider connection error:', error);
      setIsYjsSynced(false);
    };

    newProvider.on('sync', handleSync);
    newProvider.on('status', handleStatus);
    newProvider.on('connection-error', handleError);

    setProvider(newProvider);
    setAwareness(newProvider.awareness);

    return () => {
      if (newProvider) {
        newProvider.off('sync', handleSync);
        newProvider.off('status', handleStatus);
        newProvider.off('connection-error', handleError);
        newProvider.destroy();
        setProvider(null);
        setAwareness(null);
        setIsYjsSynced(false);
      }
    };
  }, [roomId, ydoc]);

  useEffect(() => {
    const handleBeforeUnload = () => {
      if (ydoc && documentsMap.has(roomId)) {
        ydoc.destroy();
        documentsMap.delete(roomId);
      }
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload);
      if (roomId && documentsMap.has(roomId)) {
        const doc = documentsMap.get(roomId);
        doc.destroy();
        documentsMap.delete(roomId);
      }
    };
  }, [roomId, ydoc]);

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
