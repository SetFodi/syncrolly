// src/components/UserPresence.jsx
import React, { useState, useEffect } from 'react';
import styles from './UserPresence.module.css';

const UserPresence = ({ users, currentUserId }) => {
  const [expandedList, setExpandedList] = useState(false);
  const [userList, setUserList] = useState([]);
  const [activeCount, setActiveCount] = useState(0);

  useEffect(() => {
    if (users) {
      // Convert users object to array and sort
      const userArray = Object.entries(users).map(([userId, userName]) => ({
        userId,
        userName,
        isCurrentUser: userId === currentUserId,
        color: getRandomColor(userId)
      }));
      
      // Sort with current user first, then alphabetically
      userArray.sort((a, b) => {
        if (a.isCurrentUser) return -1;
        if (b.isCurrentUser) return 1;
        return a.userName.localeCompare(b.userName);
      });
      
      setUserList(userArray);
      setActiveCount(userArray.length);
    }
  }, [users, currentUserId]);

  // Generate a consistent color based on user ID
  const getRandomColor = (userId) => {
    // Generate a hash from the userId string
    let hash = 0;
    for (let i = 0; i < userId.length; i++) {
      hash = userId.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    // Convert the hash to a color
    const hue = Math.abs(hash % 360);
    return `hsl(${hue}, 70%, 60%)`;
  };

  const toggleExpand = () => {
    setExpandedList(!expandedList);
  };

  return (
    <div className={styles.userPresenceContainer}>
      <div 
        className={`${styles.userCounter} ${expandedList ? styles.expanded : ''}`}
        onClick={toggleExpand}
      >
        <div className={styles.userCountBadge}>
          <span>{activeCount}</span>
          <i className="fas fa-users"></i>
        </div>
        <span className={styles.userCountText}>
          {activeCount === 1 ? 'User' : 'Users'} Online
        </span>
      </div>
      
      {expandedList && (
        <div className={styles.userList}>
          {userList.map((user) => (
            <div 
              key={user.userId} 
              className={`${styles.userItem} ${user.isCurrentUser ? styles.currentUser : ''}`}
            >
              <div 
                className={styles.userAvatar} 
                style={{ backgroundColor: user.color }}
              >
                {user.userName.charAt(0).toUpperCase()}
              </div>
              <span className={styles.userName}>
                {user.userName} {user.isCurrentUser && <span>(You)</span>}
              </span>
              <div className={styles.userStatus}></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default UserPresence;
