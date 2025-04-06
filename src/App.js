import { useState } from 'react';
import { BrowserRouter as Router, Route, Routes, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage';
import RoomPage from './pages/RoomPage';
import './App.css';

// Modal for creating a room
function RoomCreationModal({ onClose, showModal }) {
  const [roomName, setRoomName] = useState('');
  const [userName, setUserName] = useState('');
  const navigate = useNavigate();
  
  // Handle room creation
  const handleCreateRoom = () => {
    if (!userName) {
      alert('Please enter your name!');
      return;
    }
    // a random room name if the user doesn't specify one
    const generatedRoomName = roomName || Math.random().toString(36).substring(2, 9);
    localStorage.setItem('userName', userName);
    const isCreator = true; // Mark the user as the room creator
    onClose(); // Close the modal
    // Navigate to the room page with the room name and creator flag
    navigate(`/room/${generatedRoomName}`, { state: { isCreator, password: '' } });
  };
  
  const handleClose = () => {
    setRoomName('');
    setUserName('');
    onClose();
  };

  return (
    <div className={`modal-overlay ${showModal ? 'show' : ''}`}>
      <div className={`modal-content ${showModal ? 'show' : ''}`}>
        <button onClick={handleClose} className="close-btn">
          <i className="fas fa-times"></i>
        </button>
        <h2>Create or Join a Room</h2>
        <div className="input-group">
          <input
            type="text"
            placeholder="Your Name"
            value={userName}
            onChange={(e) => setUserName(e.target.value)}
            className="modal-input"
            required
          />
          <label className="input-label">Your Name</label>
        </div>

        <div className="input-group">
          <input
            type="text"
            placeholder="Room Name (optional)"
            value={roomName}
            onChange={(e) => setRoomName(e.target.value)}
            className="modal-input"
          />
          <label className="input-label">Room Name (optional)</label>
        </div>

        <div className="modal-buttons">
          <button onClick={handleCreateRoom} className="modal-btn join-btn">
            <span>Join Room</span>
            <i className="fas fa-arrow-right"></i>
          </button>
          <button onClick={handleClose} className="modal-btn cancel-btn">
            <span>Cancel</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// Main App component
function App() {
  const [showModal, setShowModal] = useState(false);
  
  // Function to open the room creation modal
  const openModal = () => {
    setShowModal(true);
  };
  
  // Function to close the modal
  const closeModal = () => {
    setShowModal(false);
  };
  
  return (
    <Router>
      {/* Only render the modal after 'showModal' is true */}
      {showModal && <RoomCreationModal onClose={closeModal} showModal={showModal} />}
      <Routes>
        {/* Home page where user can create a room */}
        <Route
          path="/"
          element={<HomePage onCreateRoom={openModal} />}
        />
        {/* Room page where the room content is displayed */}
        <Route path="/room/:roomId" element={<RoomPage />} />
      </Routes>
    </Router>
  );
}

export default App;