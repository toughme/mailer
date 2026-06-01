import { useState, useCallback, useRef } from 'react';

function useProcess() {
  const [process, setProcess] = useState(null);
  const abortControllerRef = useRef(null);

  const startProcess = useCallback((title, options = {}) => {
    abortControllerRef.current = new AbortController();
    
    setProcess({
      isOpen: true,
      title,
      message: options.message || 'Processing...',
      progress: options.progress || 0,
      total: options.total || 0,
      ...options
    });
  }, []);

  const updateProcess = useCallback((updates) => {
    setProcess((prev) => (prev ? { ...prev, ...updates } : null));
  }, []);

  const completeProcess = useCallback((finalMessage = 'Complete') => {
    setProcess((prev) => (prev ? { ...prev, isOpen: false, message: finalMessage } : null));
    setTimeout(() => setProcess(null), 500);
  }, []);

  const cancelProcess = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setProcess((prev) => (prev ? { ...prev, isOpen: false } : null));
    setTimeout(() => setProcess(null), 300);
  }, []);

  const getAbortSignal = useCallback(() => {
    return abortControllerRef.current?.signal;
  }, []);

  return {
    process,
    startProcess,
    updateProcess,
    completeProcess,
    cancelProcess,
    getAbortSignal
  };
}

export default useProcess;
