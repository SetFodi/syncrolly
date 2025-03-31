import React, { useState, useEffect, useRef } from 'react';
import styles from './HomePage.module.css';
import { Link } from 'react-router-dom';
import '@fortawesome/fontawesome-free/css/all.min.css';

function HomePage({ onCreateRoom }) {
  const storedTheme = localStorage.getItem('theme');
  const [isDarkMode, setIsDarkMode] = useState(storedTheme === 'dark');
  const [isLoaded, setIsLoaded] = useState(false);
  const [animateBackground, setAnimateBackground] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const roomBtnRef = useRef(null);
  
  // Handle mouse movement for parallax effects
  const handleMouseMove = (e) => {
    setMousePosition({
      x: e.clientX / window.innerWidth,
      y: e.clientY / window.innerHeight
    });
  };

  useEffect(() => {
    // Set theme in localStorage
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
    
    // Add mousemove event listener for parallax effects
    window.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [isDarkMode]);

  useEffect(() => {
    // Trigger entrance animation sequence
    const timer1 = setTimeout(() => setIsLoaded(true), 300);
    const timer2 = setTimeout(() => setAnimateBackground(true), 800);
    
    // Add scroll listener for animations
    const handleScroll = () => {
      const elements = document.querySelectorAll(`.${styles['animate-on-scroll']}`);
      elements.forEach(el => {
        const rect = el.getBoundingClientRect();
        const isVisible = rect.top < window.innerHeight * 0.8;
        if (isVisible) {
          el.classList.add(styles.visible);
        }
      });
    };
    
    window.addEventListener('scroll', handleScroll);
    // Trigger once on load
    handleScroll();
    
    // Clean up
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const toggleTheme = () => {
    setIsDarkMode(prevMode => !prevMode);
  };

  // Create ripple effect for the button
  const createRipple = (e) => {
    if (!roomBtnRef.current) return;
    
    const button = roomBtnRef.current;
    const rect = button.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const ripple = document.createElement('span');
    ripple.classList.add(styles.ripple);
    ripple.style.left = `${x}px`;
    ripple.style.top = `${y}px`;
    
    button.appendChild(ripple);
    
    setTimeout(() => {
      ripple.remove();
    }, 600);
  };

  // Calculate dynamic styles for parallax elements
  const getParallaxStyle = (factor) => {
    return {
      transform: `translate(${mousePosition.x * factor}px, ${mousePosition.y * factor}px)`
    };
  };

  return (
    <div 
      className={`
        ${styles['home-container']} 
        ${isDarkMode ? styles.dark : styles.light} 
        ${isLoaded ? styles.loaded : ''}
      `}
    >
      {/* Animated background elements */}
      <div className={`${styles['background-container']} ${animateBackground ? styles.animate : ''}`}>
        <div className={styles['gradient-orbs']}>
          <div 
            className={`${styles.orb} ${styles.orb1}`}
            style={getParallaxStyle(-20)}
          ></div>
          <div 
            className={`${styles.orb} ${styles.orb2}`}
            style={getParallaxStyle(30)}
          ></div>
          <div 
            className={`${styles.orb} ${styles.orb3}`}
            style={getParallaxStyle(-15)}
          ></div>
        </div>
        
        <div className={styles['grid-overlay']}></div>
      </div>
      
      {/* Content area */}
      <div className={styles['content-area']}>
        {/* Header section */}
        <header className={`${styles.header} ${isLoaded ? styles.visible : ''}`}>
          <div className={styles['logo-container']}>
            <Link to="/">
              <img
                src={require('../assets/syncrolly-logo.png')}
                alt="Syncrolly Logo"
                className={styles['syncrolly-logo']}
              />
            </Link>
          </div>
          
          <div className={styles['theme-toggle-container']}>
            <button
              onClick={toggleTheme}
              className={styles['theme-toggle']}
              aria-label="Toggle Theme"
            >
              <div className={styles['toggle-track']}>
                <div className={`${styles['toggle-thumb']} ${isDarkMode ? styles.active : ''}`}>
                  <i className={isDarkMode ? "fas fa-moon" : "fas fa-sun"}></i>
                </div>
              </div>
              <span className={styles['toggle-label']}>
                {isDarkMode ? 'Dark Mode' : 'Light Mode'}
              </span>
            </button>
          </div>
        </header>
        
        <main className={styles.main}>
  <div className={`${styles['headline-container']} ${isLoaded ? styles.visible : ''}`}>
    <h1 className={styles.headline}>
      <div className={styles['headline-animation']}>
        <span className={styles['headline-welcome']}>Welcome to</span>
      </div>
      <div className={styles['headline-animation']} style={{ animationDelay: '0.3s' }}>
        <div className={styles['brand-container']}>
          <span className={styles['headline-brand']}>Syncrolly</span>
          <span className={styles['version-tag']}>2.0</span>
        </div>
      </div>
    </h1>
    
    <div className={styles['headline-decoration']}>
      <svg width="100" height="12" viewBox="0 0 100 12" className={styles['decoration-svg']}>
        <path d="M0,6 C30,0 70,0 100,6" className={styles['decoration-path']} />
      </svg>
    </div>
  </div>
  
  <p className={`${styles.tagline} ${isLoaded ? styles.visible : ''}`} style={{ animationDelay: '0.6s' }}>
    Collaborate and share in real-time with unparalleled ease
  </p>
  
  <div className={`${styles['cta-container']} ${isLoaded ? styles.visible : ''}`} style={{ animationDelay: '0.9s' }}>
    <button 
      ref={roomBtnRef}
      onClick={(e) => {
        createRipple(e);
        onCreateRoom();
      }} 
      className={styles['create-room-btn']}
    >
      <span className={styles['btn-text']}>Create or Join a Room</span>
      <span className={styles['btn-icon-container']}>
        <i className={`fas fa-arrow-right ${styles['btn-icon']}`}></i>
      </span>
    </button>
    
    <div className={styles['cta-features']}>
      <div className={styles.feature}>
        <i className="fas fa-bolt"></i>
        <span>Instant Connection</span>
      </div>
      <div className={styles.feature}>
        <i className="fas fa-shield-alt"></i>
        <span>Secure Sharing</span>
      </div>
      <div className={styles.feature}>
        <i className="fas fa-sync-alt"></i>
        <span>Real-time Sync</span>
      </div>
    </div>
  </div>
</main>
{/* Footer */}
        <footer className={`${styles.footer} ${isLoaded ? styles.visible : ''}`} style={{ animationDelay: '1.2s' }}>
          <div className={styles['footer-content']}>
            <div className={styles['footer-branding']}>
              <h3 className={styles['footer-title']}>Syncrolly</h3>
              <p className={styles['footer-tagline']}>Connecting people through seamless collaboration</p>
            </div>
            
            <div className={styles['footer-links']}>
              <div className={styles['footer-column']}>
                <h4>Connect With Us</h4>
                <div className={styles['social-links']}>
                  <a 
                    href="https://www.instagram.com/syncrolly/" 
                    target="_blank" 
                    rel="noopener noreferrer" 
                    className={styles['social-link']}
                  >
                    <i className="fab fa-instagram"></i>
                  </a>
                  <a 
                    href="https://www.linkedin.com/in/luka-partenadze-394675348/" target='_blank' 
                    className={styles['social-link']}
                  >
                    <i className="fab fa-linkedin-in"></i>
                  </a>
                  <a 
                    href="https://github.com/SetFodi" target='_blank'
                    className={styles['social-link']}
                  >
                    <i className="fab fa-github"></i>
                  </a>
                </div>
              </div>
              
              <div className={styles['footer-column']}>
                <h4>Company</h4>
                <ul className={styles['footer-nav']}>
                  <li><a href="#">About Us</a></li>
                  <li><a href="#">Contact</a></li>
                </ul>
              </div>
            </div>
          </div>
          
          <div className={styles['footer-bottom']}>
            <p>&copy; 2024 <strong>LGA Corporation</strong>. All rights reserved.</p>
          </div>
        </footer>
      </div>
    </div>
  );
}

export default HomePage;
