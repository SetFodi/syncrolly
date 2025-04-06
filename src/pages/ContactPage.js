// ContactPage.jsx
import React, { useState, useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import styles from './ContactPage.module.css';
import '@fortawesome/fontawesome-free/css/all.min.css';

function ContactPage() {
  // ... (keep all your existing state: theme, isLoaded, formData, validation, etc.)
  const storedTheme = localStorage.getItem('theme') || 'light';
  const [theme, setTheme] = useState(storedTheme);
  const [isLoaded, setIsLoaded] = useState(false);
  const [animateBackground, setAnimateBackground] = useState(false);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });
  const [formStatus, setFormStatus] = useState('idle'); // idle, sending, success, error
  const formRef = useRef(null);

  const [formData, setFormData] = useState({
    name: '',
    email: '',
    subject: '',
    message: ''
  });

  const [validation, setValidation] = useState({
    name: true,
    email: true,
    subject: true,
    message: true
  });

  // ... (keep your useEffect hooks for theme, load animations, mouse move, scroll)
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
  
  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({ ...prev, [name]: value }));
    setValidation(prev => ({ ...prev, [name]: true }));
  };
  
  const validateForm = () => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    const newValidation = {
      name: formData.name.trim().length >= 2,
      email: emailRegex.test(formData.email),
      subject: formData.subject.trim().length >= 3,
      message: formData.message.trim().length >= 10
    };
    setValidation(newValidation);
    return Object.values(newValidation).every(valid => valid);
  };
  
  // --- MODIFIED handleSubmit ---
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!validateForm()) {
      return;
    }

    setFormStatus('sending');

    // --- USE YOUR ACTUAL FORMSPREE ENDPOINT URL HERE ---
    const formspreeEndpoint = 'https://formspree.io/f/xovepegn'; 
    // --- This is the URL you provided ---

    try {
      const response = await fetch(formspreeEndpoint, {
        method: 'POST',
        headers: {
          // Use JSON to send the data
          'Content-Type': 'application/json',
          // Tell Formspree you want a JSON response back for AJAX
          'Accept': 'application/json' 
        },
        // Convert your form data state to a JSON string
        body: JSON.stringify(formData) 
      });

      if (response.ok) {
        // Formspree received it successfully
        setFormStatus('success');
        // Clear the form fields
        setFormData({ name: '', email: '', subject: '', message: '' });
        // Reset validation state
        setValidation({ name: true, email: true, subject: true, message: true });

        // Hide success message after a delay
        setTimeout(() => {
          setFormStatus('idle');
        }, 5000);
      } else {
        // Handle server-side errors from Formspree
        // You could try parsing response.json() here for more details if needed
        const data = await response.json();
        if (Object.hasOwn(data, 'errors')) {
          // Log specific Formspree errors if available
          console.error('Formspree errors:', data["errors"].map(error => error["message"]).join(", "));
        } else {
          console.error('Formspree submission failed:', response);
        }
        throw new Error('Form submission failed'); 
      }

    } catch (error) {
      // Handle network errors or errors thrown above
      console.error('Contact form submission error:', error);
      setFormStatus('error');

      // Hide error message after a delay
      setTimeout(() => {
        setFormStatus('idle');
      }, 5000);
    }
  };
  // --- END OF MODIFIED handleSubmit ---

  // --- The rest of your component's JSX remains the same ---
  return (
    <div className={`${styles['contact-container']} ${styles[theme]} ${isLoaded ? styles.loaded : ''}`}>
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
            <Link to="/about" className={styles.navLink}>About</Link>
            <Link to="/contact" className={`${styles.navLink} ${styles.active}`}>Contact</Link>
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
              <span className={styles['title-accent']}>Contact</span> Us
            </h1>
            <div className={styles['title-decoration']}>
              <svg width="100" height="12" viewBox="0 0 100 12" className={styles['decoration-svg']}>
                <path d="M0,6 C30,0 70,0 100,6" className={styles['decoration-path']} />
              </svg>
            </div>
          </div>
          
          <div className={`${styles['contact-content']} ${isLoaded ? styles.visible : ''}`}>
            <div className={styles['contact-info']}>
              {/* ... Info Cards ... */}
              <div className={styles['info-card']}>
                <div className={styles['info-icon']}>
                  <i className="fas fa-envelope"></i>
                </div>
                <h3>Email Us</h3>
                <p>
                  Questions, feedback, or support inquiries? 
                  Reach out directly to our team.
                </p>
                <a href="mailto:syncrolly@gmail.com" className={styles.contactLink}>
                  syncrolly@gmail.com
                </a>
              </div>
              
              <div className={styles['info-card']}>
                <div className={styles['info-icon']}>
                  <i className="fas fa-comment-dots"></i>
                </div>
                <h3>Social Media</h3>
                <p>
                  Connect with us on social platforms for updates,
                  tips, and community interaction.
                </p>
                <div className={styles['social-links']}>
                  {/* ... Social Links ... */}
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
            
            <div className={styles['contact-form-wrapper']}>
              <div className={styles['form-card']}>
                <h2>Send Us a Message</h2>
                <p>We'd love to hear from you! Fill out the form below and we'll get back to you as soon as possible.</p>
                
                {/* Success/Error Messages remain the same */}
                {formStatus === 'success' && (
                  <div className={styles['form-message-success']}>
                    <i className="fas fa-check-circle"></i>
                    <p>Your message has been sent successfully! We'll get back to you soon.</p>
                  </div>
                )}
                
                {formStatus === 'error' && (
                  <div className={styles['form-message-error']}>
                    <i className="fas fa-exclamation-circle"></i>
                    <p>There was an error sending your message. Please try again later or check the console for details.</p> 
                    {/* Added note about console */}
                  </div>
                )}
                
                {/* Ensure form tag uses the handler */}
                <form ref={formRef} onSubmit={handleSubmit} className={styles['contact-form']}>
                  {/* Input Groups remain the same */}
                  <div className={styles['form-group']}>
                    <div className={styles['input-container']}>
                      <i className="fas fa-user"></i>
                      <input 
                        type="text" 
                        name="name" // Ensure name attribute matches state key
                        value={formData.name}
                        onChange={handleInputChange}
                        placeholder="Your Name" 
                        className={!validation.name ? styles.error : ''}
                        disabled={formStatus === 'sending'}
                      />
                    </div>
                    {!validation.name && (
                      <span className={styles['validation-message']}>
                        Please enter your name (at least 2 characters)
                      </span>
                    )}
                  </div>
                  
                  <div className={styles['form-group']}>
                    <div className={styles['input-container']}>
                      <i className="fas fa-envelope"></i>
                      <input 
                        type="email" 
                        name="email" // Ensure name attribute matches state key
                        value={formData.email}
                        onChange={handleInputChange}
                        placeholder="Your Email" 
                        className={!validation.email ? styles.error : ''}
                        disabled={formStatus === 'sending'}
                      />
                    </div>
                    {!validation.email && (
                      <span className={styles['validation-message']}>
                        Please enter a valid email address
                      </span>
                    )}
                  </div>

                  <div className={styles['form-group']}>
                    <div className={styles['input-container']}>
                      <i className="fas fa-tag"></i>
                      <input 
                        type="text" 
                        name="subject" // Ensure name attribute matches state key
                        value={formData.subject}
                        onChange={handleInputChange}
                        placeholder="Subject" 
                        className={!validation.subject ? styles.error : ''}
                        disabled={formStatus === 'sending'}
                      />
                    </div>
                    {!validation.subject && (
                      <span className={styles['validation-message']}>
                        Please enter a subject (at least 3 characters)
                      </span>
                    )}
                  </div>
                  
                  <div className={styles['form-group']}>
                    <div className={styles['input-container']}>
                      <i className="fas fa-comment-alt"></i>
                      <textarea 
                        name="message" // Ensure name attribute matches state key
                        value={formData.message}
                        onChange={handleInputChange}
                        placeholder="Your Message" 
                        rows="6"
                        className={!validation.message ? styles.error : ''}
                        disabled={formStatus === 'sending'}
                      ></textarea>
                    </div>
                    {!validation.message && (
                      <span className={styles['validation-message']}>
                        Please enter a message (at least 10 characters)
                      </span>
                    )}
                  </div>
                  
                  {/* Submit button remains the same */}
                  <button 
                    type="submit" 
                    className={styles['submit-btn']}
                    disabled={formStatus === 'sending'}
                  >
                    {formStatus === 'sending' ? (
                      <>
                        <span className={styles.spinner}></span>
                        Sending...
                      </>
                    ) : (
                      <>
                        <i className="fas fa-paper-plane"></i>
                        Send Message
                      </>
                    )}
                  </button>
                </form>
              </div>
            </div>
          </div>
        </main>
        
        {/* Footer */}
        <footer className={`${styles.footer} ${isLoaded ? styles.visible : ''}`}>
          {/* ... Footer Content ... */}
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

export default ContactPage;
