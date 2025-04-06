// AboutPage.jsx
import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import styles from './AboutPage.module.css';
import '@fortawesome/fontawesome-free/css/all.min.css';

function AboutPage() {
  const storedTheme = localStorage.getItem('theme') || 'light';
  const [theme, setTheme] = useState(storedTheme);
  const [isLoaded, setIsLoaded] = useState(false);
  const [animateBackground, setAnimateBackground] = useState(false);
  const [activeTab, setActiveTab] = useState('about');
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

  useEffect(() => {
    localStorage.setItem('theme', theme);
    window.addEventListener('mousemove', handleMouseMove);
    
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [theme]);

  useEffect(() => {
    const timer1 = setTimeout(() => setIsLoaded(true), 300);
    const timer2 = setTimeout(() => setAnimateBackground(true), 800);
    
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
    handleScroll();
    
    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
      window.removeEventListener('scroll', handleScroll);
    };
  }, []);

  const handleMouseMove = (e) => {
    setMousePosition({
      x: e.clientX / window.innerWidth,
      y: e.clientY / window.innerHeight
    });
  };

  const toggleTheme = () => {
    setTheme(prevTheme => prevTheme === 'light' ? 'dark' : 'light');
  };

  const getParallaxStyle = (factor) => {
    return {
      transform: `translate(${mousePosition.x * factor}px, ${mousePosition.y * factor}px)`
    };
  };

  return (
    <div className={`${styles['about-container']} ${styles[theme]} ${isLoaded ? styles.loaded : ''}`}>
      {/* Animated background */}
      <div className={`${styles['background-container']} ${animateBackground ? styles.animate : ''}`}>
        <div className={styles['gradient-orbs']}>
          <div className={`${styles.orb} ${styles.orb1}`} style={getParallaxStyle(-20)}></div>
          <div className={`${styles.orb} ${styles.orb2}`} style={getParallaxStyle(30)}></div>
          <div className={`${styles.orb} ${styles.orb3}`} style={getParallaxStyle(-15)}></div>
        </div>
        <div className={styles['grid-overlay']}></div>
      </div>
      
      {/* Content area */}
      <div className={styles['content-area']}>
        {/* Header */}
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
          
          <nav className={styles.navigation}>
            <Link to="/" className={styles.navLink}>Home</Link>
            <Link to="/about" className={`${styles.navLink} ${styles.active}`}>About</Link>
            <Link to="/contact" className={styles.navLink}>Contact</Link>
          </nav>
          
          <div className={styles['theme-toggle-container']}>
            <button onClick={toggleTheme} className={styles['theme-toggle']} aria-label="Toggle Theme">
              <div className={styles['toggle-track']}>
                <div className={`${styles['toggle-thumb']} ${theme === 'dark' ? styles.active : ''}`}>
                  <i className={theme === 'dark' ? "fas fa-moon" : "fas fa-sun"}></i>
                </div>
              </div>
              <span className={styles['toggle-label']}>
                {theme === 'dark' ? 'Dark Mode' : 'Light Mode'}
              </span>
            </button>
          </div>
        </header>
        
        {/* Main content */}
        <main className={styles.main}>
          <div className={`${styles['page-title']} ${isLoaded ? styles.visible : ''}`}>
            <h1>
              <span className={styles['title-accent']}>About</span> Syncrolly
            </h1>
            <div className={styles['title-decoration']}>
              <svg width="100" height="12" viewBox="0 0 100 12" className={styles['decoration-svg']}>
                <path d="M0,6 C30,0 70,0 100,6" className={styles['decoration-path']} />
              </svg>
            </div>
          </div>
          
          {/* Tab navigation */}
          <div className={`${styles['tab-navigation']} ${isLoaded ? styles.visible : ''}`}>
            <button 
              className={`${styles['tab-btn']} ${activeTab === 'about' ? styles.active : ''}`}
              onClick={() => setActiveTab('about')}
            >
              <i className="fas fa-info-circle"></i>
              About
            </button>
            <button 
              className={`${styles['tab-btn']} ${activeTab === 'tutorial' ? styles.active : ''}`}
              onClick={() => setActiveTab('tutorial')}
            >
              <i className="fas fa-book"></i>
              Tutorial
            </button>
            <button 
              className={`${styles['tab-btn']} ${activeTab === 'faq' ? styles.active : ''}`}
              onClick={() => setActiveTab('faq')}
            >
              <i className="fas fa-question-circle"></i>
              FAQ
            </button>
          </div>
          
          {/* About content */}
          <div className={`${styles['tab-content']} ${isLoaded ? styles.visible : ''} ${activeTab === 'about' ? styles.active : ''}`}>
            <div className={styles['content-card']}>
              <h2>
                <span className={styles.icon}><i className="fas fa-code"></i></span>
                What is Syncrolly?
              </h2>
              <p>
                Syncrolly is a modern, real-time collaborative code sharing platform designed to make pair programming and remote collaboration seamless and efficient. Whether you're teaching, learning, or working together on a coding project, Syncrolly provides the tools you need for effective communication and collaboration.
              </p>
              <p>
                Unlike traditional code sharing platforms, Syncrolly combines a sleek, intuitive interface with powerful features like real-time synchronization, built-in chat, file sharing, and language-specific syntax highlighting to create an unparalleled collaborative experience.
              </p>
            </div>
            
            <div className={styles['features-grid']}>
              <div className={styles['feature-card']}>
                <div className={styles['feature-icon']}>
                  <i className="fas fa-sync-alt"></i>
                </div>
                <h3>Real-time Synchronization</h3>
                <p>See changes instantly as they happen, with no need to refresh. Perfect for live coding sessions and demonstrations.</p>
              </div>
              
              <div className={styles['feature-card']}>
                <div className={styles['feature-icon']}>
                  <i className="fas fa-comments"></i>
                </div>
                <h3>Integrated Chat</h3>
                <p>Communicate with your team without switching between applications, with notifications for new messages.</p>
              </div>
              
              <div className={styles['feature-card']}>
                <div className={styles['feature-icon']}>
                  <i className="fas fa-code"></i>
                </div>
                <h3>Multiple Languages</h3>
                <p>Support for a wide range of programming languages with proper syntax highlighting for better readability.</p>
              </div>
              
              <div className={styles['feature-card']}>
                <div className={styles['feature-icon']}>
                  <i className="fas fa-file-upload"></i>
                </div>
                <h3>File Sharing</h3>
                <p>Upload, share, and manage files directly within the platform for seamless resource sharing.</p>
              </div>
              
              <div className={styles['feature-card']}>
                <div className={styles['feature-icon']}>
                  <i className="fas fa-lock"></i>
                </div>
                <h3>Access Control</h3>
                <p>Room creators can toggle between editable and view-only modes to control when collaborators can make changes.</p>
              </div>
              
              <div className={styles['feature-card']}>
                <div className={styles['feature-icon']}>
                  <i className="fas fa-moon"></i>
                </div>
                <h3>Dark/Light Mode</h3>
                <p>Switch between themes to match your preference and reduce eye strain during long coding sessions.</p>
              </div>
            </div>
          </div>
          
          {/* Tutorial content */}
          <div className={`${styles['tab-content']} ${isLoaded ? styles.visible : ''} ${activeTab === 'tutorial' ? styles.active : ''}`}>
            <div className={styles['content-card']}>
              <h2>
                <span className={styles.icon}><i className="fas fa-book"></i></span>
                Getting Started with Syncrolly
              </h2>
              
              <div className={styles['tutorial-step']}>
                <div className={styles['step-number']}>1</div>
                <div className={styles['step-content']}>
                  <h3>Create or Join a Room</h3>
                  <p>From the homepage, click "Create or Join a Room". Enter your name and optionally specify a room name. If you don't specify a room name, a random one will be generated for you.</p>
                  <div className={styles['step-image']}>
                    <img src={require('../assets/tutorial-create-room.png')} alt="Create Room Modal" />
                  </div>
                </div>
              </div>
              
              <div className={styles['tutorial-step']}>
                <div className={styles['step-number']}>2</div>
                <div className={styles['step-content']}>
                  <h3>Share Your Room Link</h3>
                  <p>Once in the room, share the URL with your collaborators. Anyone with the link can join your room instantly by entering their name.</p>
                  <div className={styles['tip-box']}>
                    <i className="fas fa-lightbulb"></i>
                    <span>Tip: The first person to create the room is the room creator and has special permissions to control editability.</span>
                  </div>
                </div>
              </div>
              
              <div className={styles['tutorial-step']}>
                <div className={styles['step-number']}>3</div>
                <div className={styles['step-content']}>
                  <h3>Writing and Editing Code</h3>
                  <p>Start typing in the editor to write or edit code. All changes are synchronized in real-time to all users in the room.</p>
                  <h4>Key Features in the Editor:</h4>
                  <ul className={styles['feature-list']}>
                    <li>
                      <i className="fas fa-language"></i>
                      <span><strong>Language Selection:</strong> Choose the appropriate language for syntax highlighting from the dropdown in the top right.</span>
                    </li>
                    <li>
                      <i className="fas fa-lock-open"></i>
                      <span><strong>Editability Toggle:</strong> Room creators can switch between "Editable" and "View-Only" modes using the button in the header.</span>
                    </li>
                    <li>
                      <i className="fas fa-download"></i>
                      <span><strong>Download Button:</strong> Save your code locally with the correct file extension based on the selected language.</span>
                    </li>
                  </ul>
                </div>
              </div>
              
              <div className={styles['tutorial-step']}>
                <div className={styles['step-number']}>4</div>
                <div className={styles['step-content']}>
                  <h3>Using the Chat and File Sharing</h3>
                  <p>Communicate with your collaborators without leaving the platform:</p>
                  <ul className={styles['feature-list']}>
                    <li>
                      <i className="fas fa-comments"></i>
                      <span><strong>Chat:</strong> Click the "Chat" button to open the chat sidebar. New messages show a notification badge when chat is closed.</span>
                    </li>
                    <li>
                      <i className="fas fa-file"></i>
                      <span><strong>Files:</strong> Click "View Files" to upload, view, and download shared files within your room.</span>
                    </li>
                  </ul>
                </div>
              </div>
              
              <div className={styles['tutorial-step']}>
                <div className={styles['step-number']}>5</div>
                <div className={styles['step-content']}>
                  <h3>Customizing Your Experience</h3>
                  <p>Personalize Syncrolly to your preferences:</p>
                  <ul className={styles['feature-list']}>
                    <li>
                      <i className="fas fa-moon"></i>
                      <span><strong>Theme Toggle:</strong> Switch between light and dark modes using the moon/sun icon in the header.</span>
                    </li>
                  </ul>
                  <div className={styles['tip-box']}>
                    <i className="fas fa-info-circle"></i>
                    <span>Note: Your theme preference and username are saved locally and will be remembered for future sessions.</span>
                  </div>
                </div>
              </div>
            </div>
          </div>
          
          {/* FAQ content */}
          <div className={`${styles['tab-content']} ${isLoaded ? styles.visible : ''} ${activeTab === 'faq' ? styles.active : ''}`}>
            <div className={styles['content-card']}>
              <h2>
                <span className={styles.icon}><i className="fas fa-question-circle"></i></span>
                Frequently Asked Questions
              </h2>
              
              <div className={styles['faq-item']}>
                <div className={styles['faq-question']}>
                  <i className="fas fa-chevron-right"></i>
                  How long do rooms stay active?
                </div>
                <div className={styles['faq-answer']}>
                  <p>Rooms remain active for 72 hours (3 days) after the last activity. After this period, inactive rooms are automatically cleaned up to free resources.</p>
                </div>
              </div>
              
              <div className={styles['faq-item']}>
                <div className={styles['faq-question']}>
                  <i className="fas fa-chevron-right"></i>
                  Is there a limit to how many people can join a room?
                </div>
                <div className={styles['faq-answer']}>
                  <p>While there's no hard limit, Syncrolly performs best with 2-10 concurrent users in a room. Performance may decrease with a large number of simultaneous editors.</p>
                </div>
              </div>
              
              <div className={styles['faq-item']}>
                <div className={styles['faq-question']}>
                  <i className="fas fa-chevron-right"></i>
                  Are the rooms password protected?
                </div>
                <div className={styles['faq-answer']}>
                  <p>Currently, rooms are accessible to anyone with the link. If you need private collaboration, we recommend generating a unique room name and sharing it only with your intended collaborators.</p>
                </div>
              </div>
              
              <div className={styles['faq-item']}>
                <div className={styles['faq-question']}>
                  <i className="fas fa-chevron-right"></i>
                  What file types can be uploaded?
                </div>
                <div className={styles['faq-answer']}>
                  <p>Syncrolly supports common file formats including images (.jpg, .png), documents (.pdf, .txt), code files (.html, .js, .css, .py, .php), and archives (.zip, .rar, .7z). The maximum file size is 10MB.</p>
                </div>
              </div>
              
              <div className={styles['faq-item']}>
                <div className={styles['faq-question']}>
                  <i className="fas fa-chevron-right"></i>
                  What happens if my connection drops?
                </div>
                <div className={styles['faq-answer']}>
                  <p>Syncrolly automatically attempts to reconnect if your connection drops. When reconnected, it will synchronize any changes that occurred while you were offline.</p>
                </div>
              </div>
              
              <div className={styles['faq-item']}>
                <div className={styles['faq-question']}>
                  <i className="fas fa-chevron-right"></i>
                  Can I use Syncrolly on mobile devices?
                </div>
                <div className={styles['faq-answer']}>
                  <p>Yes, Syncrolly is responsive and works on mobile devices. However, for the best code editing experience, we recommend using a desktop or laptop computer.</p>
                </div>
              </div>
              
              <div className={styles['faq-item']}>
                <div className={styles['faq-question']}>
                  <i className="fas fa-chevron-right"></i>
                  How can I report bugs or request features?
                </div>
                <div className={styles['faq-answer']}>
                  <p>You can report bugs or request features through our <Link to="/contact">Contact page</Link> or by reaching out to us on <a href="https://www.instagram.com/syncrolly/" target="_blank" rel="noopener noreferrer">Instagram</a>.</p>
                </div>
              </div>
            </div>
          </div>
        </main>
        
        {/* Footer */}
        <footer className={`${styles.footer} ${isLoaded ? styles.visible : ''}`}>
          <div className={styles['footer-content']}>
            <div className={styles['footer-branding']}>
              <h3 className={styles['footer-title']}>Syncrolly</h3>
              <p className={styles['footer-tagline']}>Connecting people through seamless collaboration</p>
            </div>
            
            <div className={styles['footer-links']}>
              <div className={styles['footer-column']}>
                <h4>Quick Links</h4>
                <ul className={styles['footer-nav']}>
                  <li><Link to="/">Home</Link></li>
                  <li><Link to="/about">About</Link></li>
                  <li><Link to="/contact">Contact</Link></li>
                </ul>
              </div>
              
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
                    href="https://www.linkedin.com/in/luka-partenadze-394675348/" 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className={styles['social-link']}
                  >
                    <i className="fab fa-linkedin-in"></i>
                  </a>
                  <a 
                    href="https://github.com/SetFodi"
                    target="_blank" 
                    rel="noopener noreferrer"
                    className={styles['social-link']}
                  >
                    <i className="fab fa-github"></i>
                  </a>
                </div>
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

export default AboutPage;