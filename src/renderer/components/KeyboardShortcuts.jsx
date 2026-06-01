import React, { useContext } from 'react';
import { AppContext } from '../contexts/AppContext';

function KeyboardShortcuts() {
  const { showKeyboardShortcuts, setShowKeyboardShortcuts } = useContext(AppContext);

  if (!showKeyboardShortcuts) {
    return null;
  }

  return (
    <div className="keyboard-shortcuts-modal" onClick={() => setShowKeyboardShortcuts(false)}>
      <div className="keyboard-shortcuts-content" onClick={(e) => e.stopPropagation()}>
        <button
          className="keyboard-shortcuts-close"
          onClick={() => setShowKeyboardShortcuts(false)}
        >
          ✕
        </button>
        <h2>Keyboard Shortcuts</h2>
        <div className="shortcuts-grid">
          <div className="shortcut-group">
            <h3>Navigation</h3>
            <div className="shortcut-item">
              <kbd>?</kbd>
              <span>Toggle this menu</span>
            </div>
            <div className="shortcut-item">
              <kbd>Cmd/Ctrl + /</kbd>
              <span>Focus search</span>
            </div>
          </div>
          <div className="shortcut-group">
            <h3>Layout</h3>
            <div className="shortcut-item">
              <kbd>Cmd/Ctrl + \</kbd>
              <span>Toggle sidebar</span>
            </div>
          </div>
          <div className="shortcut-group">
            <h3>Coming Soon</h3>
            <div className="shortcut-item">
              <kbd>Cmd/Ctrl + K</kbd>
              <span>Command palette</span>
            </div>
            <div className="shortcut-item">
              <kbd>Cmd/Ctrl + ,</kbd>
              <span>Settings</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default KeyboardShortcuts;
