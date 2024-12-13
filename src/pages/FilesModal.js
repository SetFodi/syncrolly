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
        <button onClick={onClose} className={styles['close-btn']}>X</button>
        <h2>Files</h2>
        <button onClick={() => document.getElementById('fileUpload').click()} className={styles['file-upload-btn']}>
          Select File
        </button>
        <input
          type="file"
          id="fileUpload"
          style={{ display: 'none' }}
          onChange={(e) => setFileInput(e.target.files[0])}
        />
        <button onClick={handleFileUpload} className={styles['file-upload-submit']}>
          Submit
        </button>
        <div className={styles['files-list']}>
          <h3>Uploaded Files:</h3>
          {files.map((file) => (
            <div key={file._id} className={styles['file-item']}>
              <a href={file.fileUrl} download>{file.fileName}</a>
              <button
                onClick={() => handleDeleteFile(file._id)}
                className={styles['delete-btn']}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default FilesModal;
