import React from 'react';
import styles from './FilesModal.module.css';

const FilesModal = ({
  files,
  fileInput,
  setFileInput,
  handleFileUpload,
  handleDeleteFile,
  onClose,
}) => {
  return (
    <div className={styles['modal-overlay']}>
      <div className={styles['modal-content']}>
        <button onClick={onClose} className={styles['close-btn']}>
          <i className="fas fa-times"></i>
        </button>
        
        <h2>Files</h2>
        
        <div className={styles['upload-section']}>
          <p>Upload a new file to share with everyone in the room</p>
          
          <div className={styles['upload-controls']}>
            <div className={styles['file-select-wrapper']}>
              <button 
                onClick={() => document.getElementById('fileUpload').click()} 
                className={styles['file-upload-btn']}
              >
                <i className="fas fa-file-upload"></i>
                <span>Select File</span>
              </button>
              
              <span className={styles['file-name']}>
                {fileInput ? fileInput.name : 'No file selected'}
              </span>
            </div>
            
            <button 
              onClick={handleFileUpload} 
              className={styles['file-upload-submit']}
              disabled={!fileInput}
            >
              <i className="fas fa-cloud-upload-alt"></i>
              <span>Upload</span>
            </button>
          </div>
          
          <input
            type="file"
            id="fileUpload"
            style={{ display: 'none' }}
            onChange={(e) => setFileInput(e.target.files[0])}
          />
        </div>
        
        <div className={styles['files-list']}>
          <h3>Uploaded Files</h3>
          
          {files.length === 0 ? (
            <div className={styles['no-files']}>
              <i className="fas fa-folder-open"></i>
              <p>No files have been uploaded yet</p>
            </div>
          ) : (
            files.map((file) => (
              <div key={file._id} className={styles['file-item']}>
                <div className={styles['file-info']}>
                  <i className="fas fa-file-alt"></i>
                  <a href={file.fileUrl} download>{file.fileName}</a>
                </div>
                <button
                  onClick={() => handleDeleteFile(file._id)}
                  className={styles['delete-btn']}
                  aria-label="Delete file"
                >
                  <i className="fas fa-trash-alt"></i>
                </button>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default FilesModal;