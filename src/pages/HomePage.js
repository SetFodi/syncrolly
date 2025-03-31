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
    <div className={`${styles['home-container']} ${isDarkMode ? styles.dark : styles.light}`}>
      <div className={styles['logo-container']}>
        <Link to="/">
          <img
            src={require('../assets/syncrolly-logo.png')}
            alt="Syncrolly Logo"
            className={styles['syncrolly-logo']}
          />
        </Link>
      </div>

      <h1>Welcome to Syncrolly</h1>
      <p>Collaborate and share in real-time!</p>

      <button onClick={onCreateRoom} className={styles['create-room-btn']}>
        Create or Join a Room
      </button>

      <div className={styles['theme-toggle']}>
        <button onClick={toggleTheme} className={styles['theme-btn']} aria-label="Toggle Theme">
          {isDarkMode ? <i className="fas fa-sun"></i> : <i className="fas fa-moon"></i>}
        </button>
      </div>

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

export default HomePage;
