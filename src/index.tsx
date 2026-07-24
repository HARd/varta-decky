import {
  ButtonItem,
  PanelSection,
  PanelSectionRow,
  staticClasses,
} from "@decky/ui";
import { callable, definePlugin, routerHook, toaster } from "@decky/api";
import { useEffect, useState, Component, ReactNode, ErrorInfo } from "react";
import { reportError } from "./errorReporter";
import { FaFlag } from "react-icons/fa";
import {
  startSteamUiInjection,
  stopSteamUiInjection,
  updateSteamUiInjectionSettings,
} from "./injector";
import {
  getLocalSettings,
  saveLocalSettings,
} from "./localBackend";
import { patchLibraryApp } from "./patchLibraryApp";
import { initStorePatch, refreshStorePatch } from "./storePatch";
import { initGridObserver, stopGridObserver } from "./gridObserver";
import type { AppStatus, PluginSettings, DatabaseStats } from "./types";
import { t } from "./i18n";
import { RenderAllExtensions } from "./extensions/registry";
const DEFAULT_SETTINGS: PluginSettings = {
  markHostile: true,
  markUkrainian: true,
  hostileColor: "#7a2a2a",
  ukrainianColor: "#27ae60",
  overlayOpacity: 0.35,
  showBadges: true,
  remoteDatabaseEnabled: true,
  remoteDatabaseUrl: "https://api.varta.games/public",
  libraryBadgePosition: "bottom-right",
  libraryBadgeStyle: "text",
  language: "uk",
  showReportButton: true,
  lastSeenHostileCount: 0,
  lastSeenUkrCount: 0,
  analyticsEnabled: true,
  analyticsId: "",
  showPrystanokLoc: true,
  detailedPrystanokBadges: true,
};

const getAppStatus = callable<[appid: string], AppStatus>("get_app_status");
const getAppStatuses = callable<[appids: string[]], Record<string, AppStatus>>("get_app_statuses");
const getSettings = callable<[], PluginSettings>("get_settings");
const saveSettings = callable<[{settings: PluginSettings}], PluginSettings>("save_settings");
const setSetting = callable<[{key: string, value: any}], PluginSettings>("set_setting");
const refreshDatabase = callable<[force: boolean], DatabaseStats>("refresh_database");
const getUpdateStatus = callable<[], { hasUpdate: boolean; latestVersion: string }>("get_update_status");
const applyUpdate = callable<[], { success: boolean; error?: string }>("apply_update");
const getDatabaseStats = callable<[], DatabaseStats>("get_database_stats");
const trackEvent = callable<[event: string, properties?: Record<string, any>], boolean>("track_event");



const BACKEND_TIMEOUT_MS = 5000;
let activeSettings = getLocalSettings();
if (activeSettings.remoteDatabaseUrl && activeSettings.remoteDatabaseUrl.includes("firebase")) {
  activeSettings.remoteDatabaseUrl = "https://api.varta.games/public";
  saveLocalSettings(activeSettings);
}
let fetchedFromPython = false;

function Content() {
  const [settings, setSettings] = useState<PluginSettings>(activeSettings);
  const [isLoaded, setIsLoaded] = useState(fetchedFromPython);
  const [syncing, setSyncing] = useState(false);
  const [db, setDb] = useState<DatabaseStats | null>(null);
  const [statsError, setStatsError] = useState<string | null>(null);
  const [updateInfo, setUpdateInfo] = useState<{ hasUpdate: boolean; latestVersion: string } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateError, setUpdateError] = useState<string | null>(null);
  const [updateSuccess, setUpdateSuccess] = useState(false);

  useEffect(() => {
    let mounted = true;
    setSettings(activeSettings);
    startSteamUiInjection(getResolvedAppStatus, activeSettings);

    if (!fetchedFromPython) {
      void withTimeout(getSettings(), BACKEND_TIMEOUT_MS, "get_settings")
        .then((loadedSettings) => {
          fetchedFromPython = true;
          if (!mounted) return;
          
          let merged: PluginSettings;
          if (loadedSettings && (loadedSettings as any)._is_fresh) {
            // Backend is fresh (e.g. after reinstall), push local settings to backend
            activeSettings.analyticsId = loadedSettings.analyticsId;
            merged = activeSettings;
            void saveSettings({ settings: merged });
          } else {
            // Backend has existing settings, prefer backend over local
            merged = { ...DEFAULT_SETTINGS, ...loadedSettings };
            delete (merged as any)._is_fresh;
            saveLocalSettings(merged);
          }
          
          activeSettings = merged;
          setSettings(merged);
          setIsLoaded(true);
          startSteamUiInjection(getResolvedAppStatus, merged);
        })
        .catch(() => {
          fetchedFromPython = true;
          if (mounted) setIsLoaded(true);
        });
    }

    void withTimeout(getDatabaseStats(), BACKEND_TIMEOUT_MS, "get_database_stats")
      .then((s: any) => {
        if (!mounted) return;
        if (s && s.error) {
          setStatsError(s.error);
        } else {
          setDb(s);
          setStatsError(null);
          
          if (
            s.hostileCount > settings.lastSeenHostileCount || 
            s.ukrainianCount > settings.lastSeenUkrCount
          ) {
            const diffH = Math.max(0, s.hostileCount - (settings.lastSeenHostileCount || 0));
            const diffU = Math.max(0, s.ukrainianCount - (settings.lastSeenUkrCount || 0));
            if (settings.lastSeenHostileCount !== 0) {
              toaster.toast({ 
                title: "VARTA", 
                body: t(settings.language, "toast_db_diff", { h: diffH, u: diffU }) 
              });
            }
            updateSetting("lastSeenHostileCount", s.hostileCount);
            updateSetting("lastSeenUkrCount", s.ukrainianCount);
          }
        }
      })
      .catch((err) => {
        if (mounted) setStatsError(String(err));
      });

    getUpdateStatus().then((res) => {
      if (mounted) setUpdateInfo(res);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const updateSetting = <K extends keyof PluginSettings>(key: K, value: PluginSettings[K]) => {
    const next = { ...settings, [key]: value };
    activeSettings = next;
    
    saveLocalSettings(next);
    
    setSettings(next);
    updateSteamUiInjectionSettings(next);
    refreshStorePatch();
    window.dispatchEvent(new CustomEvent("varta-settings-changed"));
    
    // Track settings_changed (skip internal/counter fields)
    const skipKeys = new Set(["lastSeenHostileCount", "lastSeenUkrCount", "analyticsId"]);
    if (!skipKeys.has(key as string)) {
      void trackEvent("settings_changed", { key: key as string, value: String(value) }).catch(() => {});
    }

    // Auto-save to Python backend in the background
    void setSetting({ key: key as string, value })
      .catch((e) => {
        console.error("Failed to auto-save setting to Python backend", e);
      });
  };

  const forceRefresh = async () => {
    setSyncing(true);
    try {
      const dbStats = await refreshDatabase(true);
      clearAppStatusCache();
      setDb(dbStats);
      refreshStorePatch();
      window.dispatchEvent(new CustomEvent("varta-settings-changed"));
      
      let notifiedDiff = false;
      if (
        dbStats.hostileCount > settings.lastSeenHostileCount || 
        dbStats.ukrainianCount > settings.lastSeenUkrCount
      ) {
        const diffH = Math.max(0, dbStats.hostileCount - (settings.lastSeenHostileCount || 0));
        const diffU = Math.max(0, dbStats.ukrainianCount - (settings.lastSeenUkrCount || 0));
        if (settings.lastSeenHostileCount !== 0) {
          toaster.toast({ 
            title: "VARTA", 
            body: t(settings.language, "toast_db_diff", { h: diffH, u: diffU }) 
          });
          notifiedDiff = true;
        }
        updateSetting("lastSeenHostileCount", dbStats.hostileCount);
        updateSetting("lastSeenUkrCount", dbStats.ukrainianCount);
      }
      
      if (!notifiedDiff) {
        toaster.toast({ title: "VARTA", body: t(settings.language, "toast_db_updated") });
      }
    } finally {
      setSyncing(false);
    }
  };

  const lang = settings.language;

  if (!isLoaded) {
    return (
      <PanelSection>
        <PanelSectionRow>
          <div style={fieldStyle}>{t(lang, "loading")}</div>
        </PanelSectionRow>
      </PanelSection>
    );
  }

  return (
    <>
      <PanelSection title={t(lang, "section_db")}>
        <PanelSectionRow>
          <div style={fieldStyle}>
            {statsError ? (
              <span style={{ color: "#e74c3c" }}>{t(lang, "db_error")}: {statsError}</span>
            ) : db ? (
              <>
                <div>{t(lang, "db_source")}: <strong>{db.source === "bundled" ? t(lang, "db_bundled") : t(lang, "db_remote")}</strong></div>
                <div>{t(lang, "db_version")}: <strong>{db.version}</strong></div>
                <div>{t(lang, "db_hostile_count")}: <strong>{db.hostileCount}</strong></div>
                <div>{t(lang, "db_ukr_count")}: <strong>{db.ukrainianCount}</strong></div>
                <div>{t(lang, "db_reports_count")}: <strong>{db.reportsCount}</strong></div>
                {db.lastRemoteError && (
                  <div style={{ color: "#e74c3c", marginTop: "4px" }}>
                    {t(lang, "db_error_sync")}: {db.lastRemoteError}
                  </div>
                )}
              </>
            ) : (
              <span>{t(lang, "loading")}</span>
            )}
          </div>
        </PanelSectionRow>
        <PanelSectionRow>
          <div style={fieldStyle}>
            <ButtonItem layout="below" disabled={syncing} onClick={forceRefresh}>
              {syncing ? t(lang, "loading") : t(lang, "menu_refresh_db")}
            </ButtonItem>
          </div>
        </PanelSectionRow>
      </PanelSection>

      <RenderAllExtensions settings={settings} setSetting={updateSetting} lang={lang} getAppStatus={getResolvedAppStatus} />

      {updateInfo?.hasUpdate && (
        <PanelSection>
          <div style={{ background: "rgba(39, 174, 96, 0.15)", border: "1px solid rgba(39, 174, 96, 0.4)", padding: "12px", borderRadius: "8px", marginTop: "16px", textAlign: "center", display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ color: "#fff", fontWeight: "bold" }}>
              {t(lang, "update_available")}{updateInfo.latestVersion}
            </div>
            
            {updateError && (
              <div style={{ color: "#e74c3c", fontSize: "12px", padding: "4px" }}>
                {t(lang, "update_failed")}: {updateError}
              </div>
            )}
            
            {updateSuccess && (
              <div style={{ color: "#2ecc71", fontSize: "13px", padding: "8px", background: "rgba(46, 204, 113, 0.1)", borderRadius: "6px" }}>
                {t(lang, "update_success")}
              </div>
            )}
            
            {!updateSuccess && (
              <ButtonItem
                layout="below"
                onClick={async () => {
                  setIsUpdating(true);
                  setUpdateError(null);
                  try {
                    const res = await applyUpdate();
                    if (!res.success) {
                      setUpdateError(res.error || "Unknown error");
                      setIsUpdating(false);
                    } else {
                      setUpdateSuccess(true);
                      setIsUpdating(false);
                    }
                  } catch (e: any) {
                    setUpdateError(e.message || "Unknown error");
                    setIsUpdating(false);
                  }
                }}
                disabled={isUpdating}
              >
                {isUpdating ? t(lang, "update_downloading") : "Оновити / Update"}
              </ButtonItem>
            )}
          </div>
        </PanelSection>
      )}
    </>
  );
}

const fieldStyle = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
  width: "100%",
  fontSize: "13px",
} as const;

class ErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean}> {
  constructor(props: {children: ReactNode}) {
    super(props);
    this.state = { hasError: false };
  }
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    reportError(error, `React ErrorBoundary: \n${errorInfo.componentStack}`);
  }
  render() {
    if (this.state.hasError) return <div style={{padding: "10px", color: "#e74c3c"}}>VARTA UI Crashed. Check Sentry logs.</div>;
    return this.props.children;
  }
}

export default definePlugin(() => {
  console.log("[VARTA] initializing");

  const libraryPatch = patchLibraryApp(getResolvedAppStatus, () => activeSettings);
  const stopStorePatch = initStorePatch(getResolvedAppStatus, () => activeSettings);
  initGridObserver(getResolvedAppStatus, () => activeSettings);
  startSteamUiInjection(getResolvedAppStatus, getLocalSettings());

  return {
    name: "VARTA",
    titleView: <div className={staticClasses.Title}>VARTA</div>,
    content: <ErrorBoundary><Content /></ErrorBoundary>,
    icon: <FaFlag />,
    onDismount() {
      routerHook.removePatch("/library/app/:appid", libraryPatch);
      stopStorePatch();
      stopGridObserver();
      stopSteamUiInjection();
    },
  };
});

const appStatusCache = new Map<string, Promise<AppStatus>>();

function clearAppStatusCache() {
  appStatusCache.clear();
}

let batchQueue: { appid: string; resolve: (val: AppStatus) => void; reject: (err: any) => void }[] = [];
let batchTimeout: number | undefined;

async function processBatch() {
  const currentQueue = batchQueue;
  batchQueue = [];
  batchTimeout = undefined;
  
  if (currentQueue.length === 0) return;
  
  const appids = currentQueue.map(q => q.appid);
  try {
    const results = await getAppStatuses(appids);
    for (const q of currentQueue) {
      if (results[q.appid]) {
        q.resolve(results[q.appid]);
      } else {
        q.resolve({ appid: q.appid, type: null } as any);
      }
    }
  } catch (err) {
    console.error("VARTA Batching IPC failed:", err);
    for (const q of currentQueue) {
      getAppStatus(q.appid).then(q.resolve).catch(q.reject);
    }
  }
}

async function getResolvedAppStatus(appid: string): Promise<AppStatus> {
  if (appStatusCache.has(appid)) {
    return appStatusCache.get(appid)!;
  }
  
  const promise = new Promise<AppStatus>((resolve, reject) => {
    batchQueue.push({ appid, resolve, reject });
    if (!batchTimeout) {
      batchTimeout = window.setTimeout(processBatch, 20);
    }
  }).catch((err) => {
    appStatusCache.delete(appid);
    throw err;
  });
  
  appStatusCache.set(appid, promise);
  return promise;
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: number | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = window.setTimeout(() => reject(new Error(`${label} timed out`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    window.clearTimeout(timer);
  }
}
