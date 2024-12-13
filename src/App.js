import { useState } from 'react';
import { BrowserRouter as Router, Route, Routes, useNavigate } from 'react-router-dom';
import HomePage from './pages/HomePage'; // Import your HomePage
import RoomPage from './pages/RoomPage'; // Import the RoomPage component
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

    // Generate a random room name if the user doesn't specify one
    const generatedRoomName = roomName || Math.random().toString(36).substring(2, 9);

    localStorage.setItem('userName', userName);
    const isCreator = true;  // Mark the user as the room creator
    onClose();  // Close the modal

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
        <h2>Create Or Join a Room</h2>
        <input
          type="text"
          placeholder="Your Name"
          value={userName}
          onChange={(e) => setUserName(e.target.value)}
          className="modal-input"
        />
        <br />
        <input
          type="text"
          placeholder="Room Name (optional)"
          value={roomName}
          onChange={(e) => setRoomName(e.target.value)}
          className="modal-input"
        />
        <br />
        <button onClick={handleCreateRoom} className="modal-btn">
          Join Room
        </button>
        <button onClick={handleClose} className="modal-btn cancel-btn">
          Cancel
        </button>
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
