import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { CURRENT_APP_VERSION } from '../config/appVersion';
import { RemoteVersionManifest } from '../types';

interface UpdateContextType {
  hasUpdate: boolean;
  isChecking: boolean;
  remoteVersion: RemoteVersionManifest | null;
  lastCheckTime: Date | null;
  isDismissed: boolean;
  hasUnsavedChanges: boolean;
  checkForUpdates: () => Promise<boolean>;
  applyUpdate: () => void;
  dismissUpdate: () => void;
  setHasUnsavedChanges: (hasChanges: boolean) => void;
  showVersionModal: boolean;
  setShowVersionModal: (show: boolean) => void;
}

const UpdateContext = createContext<UpdateContextType | undefined>(undefined);

export const UpdateProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [hasUpdate, setHasUpdate] = useState<boolean>(false);
  const [isChecking, setIsChecking] = useState<boolean>(false);
  const [remoteVersion, setRemoteVersion] = useState<RemoteVersionManifest | null>(null);
  const [lastCheckTime, setLastCheckTime] = useState<Date | null>(null);
  const [isDismissed, setIsDismissed] = useState<boolean>(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState<boolean>(false);
  const [showVersionModal, setShowVersionModal] = useState<boolean>(false);

  const checkForUpdates = useCallback(async (): Promise<boolean> => {
    try {
      setIsChecking(true);
      // Fetch /version.json with timestamp query param to guarantee bypassing HTTP cache
      const response = await fetch(`/version.json?_t=${Date.now()}`, {
        cache: 'no-store',
        headers: {
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });

      if (!response.ok) {
        setIsChecking(false);
        return false;
      }

      const manifest: RemoteVersionManifest = await response.json();
      setRemoteVersion(manifest);
      setLastCheckTime(new Date());

      // Check if buildId or version is newer
      const isNewer = 
        manifest.buildId !== CURRENT_APP_VERSION.buildId ||
        manifest.version !== CURRENT_APP_VERSION.version;

      if (isNewer) {
        setHasUpdate(true);
        console.log(`[ASFOUR Update Engine] New version detected: ${manifest.version} (Build: ${manifest.buildId}) vs Local: ${CURRENT_APP_VERSION.version}`);
      } else {
        setHasUpdate(false);
      }

      setIsChecking(false);
      return isNewer;
    } catch (err) {
      console.warn('[ASFOUR Update Engine] Version check failed (offline or network error):', err);
      setIsChecking(false);
      return false;
    }
  }, []);

  const applyUpdate = useCallback(() => {
    // Notify Service Worker to skipWaiting if available
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'SKIP_WAITING' });
    }

    // Force reload to fetch new HTML & JS bundles
    window.location.reload();
  }, []);

  const dismissUpdate = useCallback(() => {
    setIsDismissed(true);
  }, []);

  // Check on initial load
  useEffect(() => {
    checkForUpdates();

    // Check periodically every 5 minutes (300,000 ms)
    const interval = setInterval(() => {
      checkForUpdates();
    }, 5 * 60 * 1000);

    // Check when user refocuses browser window / tab
    const handleFocus = () => {
      checkForUpdates();
    };

    window.addEventListener('focus', handleFocus);

    // Listen for service worker updates
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        setHasUpdate(true);
      });
    }

    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', handleFocus);
    };
  }, [checkForUpdates]);

  return (
    <UpdateContext.Provider
      value={{
        hasUpdate: hasUpdate && !isDismissed,
        isChecking,
        remoteVersion,
        lastCheckTime,
        isDismissed,
        hasUnsavedChanges,
        checkForUpdates,
        applyUpdate,
        dismissUpdate,
        setHasUnsavedChanges,
        showVersionModal,
        setShowVersionModal,
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
};

export const useUpdate = () => {
  const context = useContext(UpdateContext);
  if (!context) {
    throw new Error('useUpdate must be used within an UpdateProvider');
  }
  return context;
};
