import React, { useRef, useContext, useEffect } from 'react';
import { AppContext } from '../contexts/AppContext';

function SidebarResizeHandle() {
  const { sidebarWidth, setSidebarWidth, sidebarCollapsed } = useContext(AppContext);
  const isResizing = useRef(false);

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing.current) return;

      const newWidth = Math.max(80, Math.min(e.clientX, 400));
      setSidebarWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
    };

    if (isResizing.current) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setSidebarWidth]);

  const handleMouseDown = () => {
    isResizing.current = true;
  };

  if (sidebarCollapsed) {
    return null;
  }

  return (
    <div
      className="sidebar-resize-handle"
      onMouseDown={handleMouseDown}
      style={{ cursor: 'col-resize' }}
    />
  );
}

export default SidebarResizeHandle;
