// frontend/src/components/LoadingScreen.jsx

import React, { useState, useEffect, useRef } from 'react';
import styles from './LoadingScreen.module.css';

const LoadingScreen = ({ connectionStatus, syncTimeout, retryCount = 0 }) => {
  const [loadingStep, setLoadingStep] = useState(0);
  const [factIndex, setFactIndex] = useState(0);
  const [showTip, setShowTip] = useState(false);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [showRetryButton, setShowRetryButton] = useState(false);
  const [clickCount, setClickCount] = useState(0);
  const [animationActive, setAnimationActive] = useState(false);
  const canvasRef = useRef(null);

  // Enhanced loading steps with more detailed information
  const loadingSteps = [
    "Initializing connection...",
    "Waking up servers...",
    "Starting Yjs sync engine...",
    "Preparing collaborative environment...",
    "Finalizing connection setup...",
    "Almost ready..."
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

  // Track connection time
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedTime(prev => prev + 1);
    }, 1000);

    return () => clearInterval(timer);
  }, []);

  // Show retry button after 20 seconds
  useEffect(() => {
    if (elapsedTime > 20) {
      setShowRetryButton(true);
    }
  }, [elapsedTime]);

  // Particle animation effect
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let animationFrameId;
    let particles = [];

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };

    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    // Particle class
    class Particle {
      constructor() {
        this.x = Math.random() * canvas.width;
        this.y = Math.random() * canvas.height;
        this.size = Math.random() * 3 + 1;
        this.speedX = Math.random() * 2 - 1;
        this.speedY = Math.random() * 2 - 1;
        this.color = `hsla(${Math.random() * 60 + 200}, 100%, 70%, ${Math.random() * 0.5 + 0.3})`;
      }

      update() {
        this.x += this.speedX;
        this.y += this.speedY;

        // Bounce off edges
        if (this.x < 0 || this.x > canvas.width) this.speedX *= -1;
        if (this.y < 0 || this.y > canvas.height) this.speedY *= -1;
      }

      draw() {
        ctx.fillStyle = this.color;
        ctx.beginPath();
        ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Initialize particles
    const initParticles = () => {
      particles = [];
      const particleCount = Math.min(Math.floor(canvas.width * canvas.height / 10000), 150);

      for (let i = 0; i < particleCount; i++) {
        particles.push(new Particle());
      }
    };

    // Animation loop
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Draw connections between particles
      ctx.strokeStyle = 'rgba(120, 180, 255, 0.1)';
      ctx.lineWidth = 0.5;

      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distance = Math.sqrt(dx * dx + dy * dy);

          if (distance < 100) {
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Update and draw particles
      particles.forEach(particle => {
        particle.update();
        particle.draw();
      });

      animationFrameId = requestAnimationFrame(animate);
    };

    // Start animation
    initParticles();
    animate();
    setAnimationActive(true);

    // Cleanup
    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(animationFrameId);
      setAnimationActive(false);
    };
  }, []);

  // Progress through loading steps with variable timing
  useEffect(() => {
    if (loadingStep < loadingSteps.length - 1) {
      // Adjust timing based on connection status and elapsed time
      let stepTime = 3000;

      // Speed up transitions if waiting too long
      if (elapsedTime > 15) {
        stepTime = 2000;
      }

      // Slow down the last step if we're still connecting
      if (loadingStep === loadingSteps.length - 2 && connectionStatus === 'connecting') {
        stepTime = 5000;
      }

      const timer = setTimeout(() => {
        setLoadingStep(prev => prev + 1);
      }, stepTime);

      return () => clearTimeout(timer);
    }
  }, [loadingStep, loadingSteps.length, connectionStatus, elapsedTime]);

  // Rotate through facts with increasing frequency if connection is taking long
  useEffect(() => {
    const factTime = elapsedTime > 30 ? 5000 : 8000;

    const factTimer = setInterval(() => {
      setFactIndex(prev => (prev + 1) % codingFacts.length);
    }, factTime);

    return () => clearInterval(factTimer);
  }, [codingFacts.length, elapsedTime]);

  // Show tip after 15 seconds or immediately if there's a sync timeout
  useEffect(() => {
    const tipTimer = setTimeout(() => {
      setShowTip(true);
    }, syncTimeout ? 0 : 15000);

    return () => clearTimeout(tipTimer);
  }, [syncTimeout]);

  return (
    <div className={styles.loadingContainer}>
      {/* Particle animation canvas */}
      <canvas ref={canvasRef} className={styles.particleCanvas}></canvas>

      <div className={styles.loadingContent}>
        <div className={styles.logoContainer}>
          <img
            src={require('../assets/syncrolly-logo.png')}
            alt="Syncrolly Logo"
            className={styles.loadingLogo}
          />
          <h1 className={styles.loadingTitle}>
            Syncrolly
            <span className={styles.loadingSubtitle}>Real-time Collaboration</span>
          </h1>
        </div>

        {/* Connection status indicator */}
        <div className={styles.connectionStatusIndicator}>
          <div className={`${styles.statusDot} ${styles[connectionStatus]}`}></div>
          <span className={styles.statusText}>
            {connectionStatus === 'connecting' ? 'Connecting...' :
             connectionStatus === 'connected' ? 'Connected, syncing document...' :
             'Connection failed'}
          </span>
          {elapsedTime > 0 && (
            <span className={styles.elapsedTime}>
              {elapsedTime}s
            </span>
          )}
          {retryCount > 0 && (
            <span className={styles.retryCount}>
              Attempt {retryCount + 1}
            </span>
          )}
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
              style={{
                width: `${Math.min((loadingStep + 1) * (100 / loadingSteps.length), 100)}%`,
                transition: elapsedTime > 30 ? 'width 0.5s ease' : 'width 1s ease'
              }}
            ></div>
          </div>
          <p className={styles.loadingMessage}>
            {loadingSteps[loadingStep]}
            {elapsedTime > 30 && <span className={styles.waitingTooLong}> (Still working on it...)</span>}
          </p>
        </div>

        <div className={styles.infoBox}>
          <h3>Did you know?</h3>
          <p className={styles.factText}>{codingFacts[factIndex]}</p>
          {syncTimeout && (
            <div className={styles.syncTimeoutNotice}>
              <p>Servers are taking longer than usual to wake up. Please be patient...</p>
              {elapsedTime > 45 && (
                <p className={styles.longWaitMessage}>
                  If this continues, try refreshing the page or checking your internet connection.
                </p>
              )}
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
              setClickCount(prev => prev + 1);
              const el = document.querySelector(`.${styles.miniGame}`);
              el.classList.add(styles.clicked);
              setTimeout(() => el.classList.remove(styles.clicked), 300);
            }}
          >
            <span className={styles.clickCount}>
              {clickCount === 0 ? 'Click me while you wait!' : `Clicks: ${clickCount}`}
            </span>
          </button>
        </div>

        {showRetryButton && (
          <div className={styles.retryContainer}>
            <button
              className={styles.retryButton}
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </button>
            <p className={styles.retryText}>
              Taking too long? Try refreshing the page.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};

export default LoadingScreen;