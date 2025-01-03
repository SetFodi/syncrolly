// YjsContext.jsx (local-only version)
import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';
import * as Y from 'yjs';
// import { WebsocketProvider } from 'y-websocket'; // <--- comment this out

const YjsContext = createContext();

export const YjsProvider = ({ children, roomId }) => {
  const ydoc = useMemo(() => new Y.Doc(), []);
  
  // We no longer need provider or awareness from a WebsocketProvider
  const [provider, setProvider] = useState(null);
  const [awareness, setAwareness] = useState(null);
  const [isYjsSynced, setIsYjsSynced] = useState(true);

  useEffect(() => {
    // If you want to do something specific when roomId changes, do it here
    // But *don't* create a WebsocketProvider
    console.log("Yjs doc is local-only. No WebsocketProvider created.");
    
    // If you want local awareness:
    // const myAwareness = new Y.awarenessProtocol.Awareness(ydoc); // for local usage only
    // setAwareness(myAwareness);
    // setIsYjsSynced(true);

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
