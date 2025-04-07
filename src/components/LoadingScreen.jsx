// frontend/src/components/LoadingScreen.jsx

import React, { useState, useEffect } from 'react';
import styles from './LoadingScreen.module.css';

const LoadingScreen = ({ connectionStatus, syncTimeout }) => {
  const [loadingStep, setLoadingStep] = useState(0);
  const [factIndex, setFactIndex] = useState(0);
  const [showTip, setShowTip] = useState(false);
  
  const loadingSteps = [
    "Initializing connection...",
    "Waking up servers...",
    "Starting Yjs sync engine...",
    "Preparing collaborative environment..."
  ];
  
  const codingFacts = [
    "The first computer bug was an actual bug - a moth found in a Harvard Mark II computer in 1947.",
    "JavaScript was created in just 10 days by Brendan Eich in 1995.",
    "The average programmer writes 10-12 lines of code per day that stays in production.",
    "The Apollo 11 computer had less processing power than a modern calculator.",
    "The first programmer was Ada Lovelace in the 1840s.",
    "GitHub hosts over 200 million repositories.",
    "The term 'debugging' exists because Grace Hopper found a moth in a computer relay in 1947.",
    "The most expensive bug in history was the Therac-25 radiation therapy machine bug.",
    "Code from the Apollo 11 mission is available on GitHub.",
    "The world's first website went live on August 6, 1991.",
    "Syncrolly uses Yjs for conflict-free collaborative editing."
  ];
  
  const programmingTips = [
    "In Syncrolly, you can change the language syntax highlighting using the dropdown menu.",
    "Remember to download your code before leaving the room.",
    "The dark mode toggle makes coding easier on your eyes at night.",
    "You can chat with collaborators using the chat panel.",
    "File sharing lets you upload examples and assets for your team."
  ];

  // Progress through loading steps
  useEffect(() => {
    if (loadingStep < loadingSteps.length - 1) {
      const timer = setTimeout(() => {
        setLoadingStep(prev => prev + 1);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [loadingStep, loadingSteps.length]);

  // Rotate through facts
  useEffect(() => {
    const factTimer = setInterval(() => {
      setFactIndex(prev => (prev + 1) % codingFacts.length);
    }, 8000);
    return () => clearInterval(factTimer);
  }, [codingFacts.length]);

  // Show tip after 15 seconds
  useEffect(() => {
    const tipTimer = setTimeout(() => {
      setShowTip(true);
    }, 15000);
    return () => clearTimeout(tipTimer);
  }, []);

  return (
    <div className={styles.loadingContainer}>
      <div className={styles.loadingContent}>
        <div className={styles.logoContainer}>
          <img 
            src={require('../assets/syncrolly-logo.png')} 
            alt="Syncrolly Logo" 
            className={styles.loadingLogo}
          />
          <h1 className={styles.loadingTitle}>Syncrolly</h1>
        </div>
        
        <div className={styles.animationContainer}>
          <div className={styles.serverWakeup}>
            {/* Server racks with blinking lights */}
            <div className={`${styles.server} ${loadingStep >= 1 ? styles.active : ''}`}>
              <div className={styles.serverLights}>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className={styles.light}></div>
                ))}
              </div>
            </div>
            <div className={`${styles.server} ${loadingStep >= 2 ? styles.active : ''}`}>
              <div className={styles.serverLights}>
                {[...Array(5)].map((_, i) => (
                  <div key={i} className={styles.light}></div>
                ))}
              </div>
            </div>
            
            {/* Yjs connection visualization */}
            <div className={`${styles.yjsConnection} ${loadingStep >= 3 ? styles.active : ''}`}>
              <div className={styles.dataPacket}></div>
              <div className={styles.dataPacket}></div>
              <div className={styles.dataPacket}></div>
            </div>
          </div>
        </div>
        
        <div className={styles.loadingStatus}>
          <div className={styles.loadingBar}>
            <div 
              className={styles.loadingProgress} 
              style={{ width: `${(loadingStep + 1) * 25}%` }}
            ></div>
          </div>
          <p className={styles.loadingMessage}>{loadingSteps[loadingStep]}</p>
        </div>
        
        <div className={styles.infoBox}>
          <h3>Did you know?</h3>
          <p className={styles.factText}>{codingFacts[factIndex]}</p>
          {syncTimeout && (
            <div className={styles.syncTimeoutNotice}>
              <p>Servers are taking longer than usual to wake up. Please be patient...</p>
            </div>
          )}
        </div>
        
        {showTip && (
          <div className={styles.syncrollyTip}>
            <h3>Syncrolly Tip</h3>
            <p>{programmingTips[Math.floor(Math.random() * programmingTips.length)]}</p>
          </div>
        )}
        
        <div className={styles.interactiveElement}>
          <button 
            className={styles.miniGame}
            onClick={() => {
              const el = document.querySelector(`.${styles.miniGame}`);
              el.classList.add(styles.clicked);
              setTimeout(() => el.classList.remove(styles.clicked), 300);
            }}
          >
            <span className={styles.clickCount}>Click me while you wait!</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default LoadingScreen;