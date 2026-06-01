import React, { createContext, useState, useEffect, useCallback } from 'react';

export const AppContext = createContext();

export function AppContextProvider({ children }) {
  const [darkMode, setDarkMode] = useState(() => {
    return localStorage.getItem('darkMode') === 'true';
  });

  const [compactMode, setCompactMode] = useState(() => {
    return localStorage.getItem('compactMode') === 'true';
  });

  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    return localStorage.getItem('sidebarCollapsed') === 'true';
  });

  const [sidebarWidth, setSidebarWidth] = useState(() => {
    const saved = localStorage.getItem('sidebarWidth');
    return saved ? parseInt(saved, 10) : 200;
  });

  const [recentItems, setRecentItems] = useState(() => {
    const saved = localStorage.getItem('recentItems');
    return saved ? JSON.parse(saved) : [];
  });

  const [openTabs, setOpenTabs] = useState([{ path: '/', label: 'Dashboard' }]);
  const [activeTab, setActiveTab] = useState('/');
  const [splitViewEnabled, setSplitViewEnabled] = useState(false);
  const [splitPanels, setSplitPanels] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [showKeyboardShortcuts, setShowKeyboardShortcuts] = useState(false);

  // Apply theme to DOM
  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark-mode');
    } else {
      root.classList.remove('dark-mode');
    }
    localStorage.setItem('darkMode', darkMode);
  }, [darkMode]);

  // Apply compact mode to DOM
  useEffect(() => {
    const root = document.documentElement;
    if (compactMode) {
      root.classList.add('compact-mode');
    } else {
      root.classList.remove('compact-mode');
    }
    localStorage.setItem('compactMode', compactMode);
  }, [compactMode]);

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('sidebarCollapsed', sidebarCollapsed);
  }, [sidebarCollapsed]);

  // Persist sidebar width
  useEffect(() => {
    localStorage.setItem('sidebarWidth', sidebarWidth);
  }, [sidebarWidth]);

  // Persist recent items
  useEffect(() => {
    localStorage.setItem('recentItems', JSON.stringify(recentItems));
  }, [recentItems]);

  const toggleDarkMode = useCallback(() => {
    setDarkMode((prev) => !prev);
  }, []);

  const toggleCompactMode = useCallback(() => {
    setCompactMode((prev) => !prev);
  }, []);

  const toggleSidebarCollapse = useCallback(() => {
    setSidebarCollapsed((prev) => !prev);
  }, []);

  const trackVisit = useCallback((type, name, route) => {
    const newItem = { type, name, route, timestamp: Date.now() };
    setRecentItems((prev) => {
      const filtered = prev.filter((item) => !(item.type === type && item.name === name));
      return [newItem, ...filtered].slice(0, 5);
    });
  }, []);

  const openTab = useCallback((path, label) => {
    setOpenTabs((prev) => {
      const exists = prev.some((tab) => tab.path === path);
      if (exists) {
        setActiveTab(path);
        return prev;
      }
      return [...prev, { path, label }];
    });
    setActiveTab(path);
  }, []);

  const closeTab = useCallback((path) => {
    setOpenTabs((prev) => prev.filter((tab) => tab.path !== path));
    if (activeTab === path) {
      setActiveTab('/');
    }
  }, [activeTab]);

  const toggleSplitView = useCallback(() => {
    setSplitViewEnabled((prev) => !prev);
  }, []);

  const value = {
    // Theme
    darkMode,
    toggleDarkMode,
    compactMode,
    toggleCompactMode,

    // Sidebar
    sidebarCollapsed,
    toggleSidebarCollapse,
    sidebarWidth,
    setSidebarWidth,

    // Recent items
    recentItems,
    trackVisit,

    // Tabs
    openTabs,
    activeTab,
    setActiveTab,
    openTab,
    closeTab,

    // Split view
    splitViewEnabled,
    toggleSplitView,
    splitPanels,
    setSplitPanels,

    // Search
    searchQuery,
    setSearchQuery,

    // Keyboard shortcuts
    showKeyboardShortcuts,
    setShowKeyboardShortcuts,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
