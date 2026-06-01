import React, { useState, useEffect } from 'react';

function ProcessModal({ isOpen, title, message, progress, total, onCancel }) {
  const [isAnimating, setIsAnimating] = useState(false);
  const [state, setState] = useState({
    title,
    message,
    progress,
    total
  });

  useEffect(() => {
    if (isOpen) {
      setIsAnimating(true);
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    // Listen for progress updates from main process
    const handleProgressUpdate = (_event, data) => {
      setState((prev) => ({
        ...prev,
        ...data,
        title: data.title || prev.title,
        message: data.message || prev.message,
        progress: data.progress !== undefined ? data.progress : prev.progress,
        total: data.total !== undefined ? data.total : prev.total
      }));
    };

    window.phantomDesktop.on('process:update', handleProgressUpdate);

    return () => {
      window.phantomDesktop.off('process:update', handleProgressUpdate);
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const progressPercent = state.total > 0 ? Math.round((state.progress / state.total) * 100) : 0;

  return (
    <div className="modal-overlay process-modal-overlay">
      <div className={`process-modal ${isAnimating ? 'animate-in' : 'animate-out'}`}>
        <div className="process-modal-header">
          <h2>{state.title}</h2>
        </div>

        <div className="process-modal-body">
          <div className="process-message">
            <p>{state.message}</p>
          </div>

          {state.total > 0 && (
            <div className="process-progress">
              <div className="progress-bar">
                <div
                  className="progress-fill"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <div className="progress-text">
                {state.progress} / {state.total} ({progressPercent}%)
              </div>
            </div>
          )}

          <div className="process-spinner">
            <div className="spinner"></div>
          </div>
        </div>

        <div className="process-modal-footer">
          <button
            className="ghost-button"
            type="button"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

export default ProcessModal;
