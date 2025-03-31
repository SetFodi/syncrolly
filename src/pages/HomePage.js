import React, { useState, useEffect } from 'react';
import styles from './HomePage.module.css';
import { Link } from 'react-router-dom';
import '@fortawesome/fontawesome-free/css/all.min.css';

function HomePage({ onCreateRoom }) {
  const storedTheme = localStorage.getItem('theme');
  const [isDarkMode, setIsDarkMode] = useState(storedTheme === 'dark');
  
  useEffect(() => {
    localStorage.setItem('theme', isDarkMode ? 'dark' : 'light');
  }, [isDarkMode]);
  
  const toggleTheme = () => {
    setIsDarkMode((prevMode) => !prevMode);
  };
  
  return (
    <div className={`home-container ${isDarkMode ? 'dark' : 'light'}`}>
      <div className="logo-container">
        <img 
          src="/syncrolly-logo.png" 
          alt="Syncrolly Logo" 
          className="syncrolly-logo" 
        />
      </div>
      
      <div className="content-wrapper">
        <h1 className="animated-title">Welcome to Syncrolly</h1>
        
        <p className="app-description">
          Collaborate and share in real-time with seamless synchronization.
          Create rooms, invite friends, and experience true connectivity.
        </p>
        
        <div className="action-section">
          <button 
            className="create-room-btn" 
            onClick={onCreateRoom}
          >
            <i className="fas fa-plus-circle mr-2"></i>
            Create or Join a Room
          </button>
        </div>
        
        <div className="theme-toggle">
          <button 
            className="theme-btn" 
            onClick={toggleTheme} 
            aria-label={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
          >
            {isDarkMode ? 
              <i className="fas fa-sun"></i> : 
              <i className="fas fa-moon"></i>
            }
          </button>
        </div>
      </div>
      
      <div className="footer">
        <div className="footer-content">
          <p className="copyright">
            © 2024 <strong>LGA Corporation</strong>. All rights reserved.
          </p>
          
          <p className="contact-info">
            Contact us on{' '}
            <a href="https://instagram.com/syncrolly" className="contact-link">
              <i className="fab fa-instagram"></i> Instagram
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default HomePage;