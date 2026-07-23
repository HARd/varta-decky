import { callable, fetchNoCors } from "@decky/api";
import { findModuleExport } from "@decky/ui";
import type { AppStatus, PluginSettings } from "./types";
import { t } from "./i18n";
import { reportError } from "./errorReporter";
import { getExtensions } from "./extensions/registry";

type Lookup = (appid: string) => Promise<AppStatus>;
type SettingsGetter = () => PluginSettings;

interface SteamWebTab {
  id: string;
  url: string;
  webSocketDebuggerUrl: string;
}

const HistoryModule = findModuleExport((exp: any) => exp?.m_history !== undefined);
const History = HistoryModule?.m_history;

let isStoreMounted = false;
let storeWebSocket: WebSocket | null = null;
let historyUnlisten: (() => void) | null = null;
let wsReady = false;
let messageId = 1;
let currentAppid = "";
let currentLookup: Lookup | null = null;
let currentSettingsGetter: SettingsGetter | null = null;
let connectTimeoutId: number | undefined;

const getCefDebuggerUrl = callable<[], string>("get_cef_debugger_url");
const reportGameToPython = callable<[any], boolean>("report_game");

function evaluateInStore(expression: string) {
  if (!storeWebSocket || storeWebSocket.readyState !== WebSocket.OPEN || !wsReady) {
    return;
  }

  storeWebSocket.send(JSON.stringify({
    id: messageId++,
    method: "Runtime.evaluate",
    params: { expression },
  }));
}

function removeBadgeFromStore() {
  evaluateInStore(`
    (function() {
      var badgeL = document.getElementById('varta-store-badge-left');
      if (badgeL) badgeL.remove();
      var badgeR = document.getElementById('varta-store-badge-right');
      if (badgeR) badgeR.remove();
    })();
  `);
}

async function injectBadgeIntoStore(appid: string) {
  console.log("VARTA: injectBadgeIntoStore called for appid", appid);
  if (!currentLookup || !currentSettingsGetter) return;
  if (!storeWebSocket || storeWebSocket.readyState !== WebSocket.OPEN || !wsReady) return;

  try {
    const status = await currentLookup(appid);
    const settings = currentSettingsGetter();
    
    // Collect chips from all extensions
    const allChips = getExtensions()
      .map(ext => ext.getStoreChips(status, settings))
      .flat();
      
    console.log("VARTA: Generated allChips for store:", allChips);

    if (allChips.length === 0) {
      removeBadgeFromStore();
      return;
    }

    // Build the container and inject chips
    let script = `
      (function() {
        console.log("VARTA: Injecting store badges!");
        var existingL = document.getElementById('varta-store-badge-left');
        if (existingL) existingL.remove();
        var existingR = document.getElementById('varta-store-badge-right');
        if (existingR) existingR.remove();

        var containerL = document.createElement('div');
        containerL.id = 'varta-store-badge-left';
        containerL.style.cssText = [
          'position: fixed',
          'left: 22px',
          'bottom: 22px',
          'z-index: 999999',
          'display: flex',
          'flex-direction: column',
          'gap: 8px',
          'align-items: flex-start'
        ].join(';');

        var containerR = document.createElement('div');
        containerR.id = 'varta-store-badge-right';
        containerR.style.cssText = [
          'position: fixed',
          'right: 22px',
          'bottom: 22px',
          'z-index: 999999',
          'display: flex',
          'flex-direction: column',
          'gap: 8px',
          'align-items: flex-end'
        ].join(';');
        
        var containerTextR = document.createElement('div');
        containerTextR.style.cssText = 'display: flex; flex-direction: column; gap: 8px; align-items: flex-end;';
        
        var containerIconsR = document.createElement('div');
        containerIconsR.style.cssText = 'display: flex; flex-direction: row; gap: 8px; justify-content: flex-end;';
        
        containerR.appendChild(containerTextR);
        containerR.appendChild(containerIconsR);
        
        document.body.appendChild(containerL);
        document.body.appendChild(containerR);
    `;
    
    allChips.forEach((chip, index) => {
      if (chip.isReport && chip.remoteDatabaseUrl) {
        script += `
          var badge${index} = document.createElement('div');
          badge${index}.textContent = ${JSON.stringify(t(settings.language, "report_btn"))};
          badge${index}.style.cssText = [
            'pointer-events: auto',
            'box-sizing: border-box',
            'padding: 8px 16px',
            'border-radius: 8px',
            'border: 1px solid rgba(255,255,255,0.2)',
            'background: rgba(30,30,30,0.85)',
            'backdrop-filter: blur(8px)',
            'box-shadow: 0 10px 28px rgba(0,0,0,0.5)',
            'color: #ccc',
            'font-family: Motiva Sans, Arial, sans-serif',
            'font-size: 14px',
            'font-weight: bold',
            'cursor: pointer',
            'transition: all 0.2s',
            'user-select: none'
          ].join(';');

          badge${index}.onmouseover = function() {
            badge${index}.style.color = '#fff';
            badge${index}.style.background = 'rgba(50,50,50,0.95)';
            badge${index}.style.transform = 'scale(1.05)';
          };
          badge${index}.onmouseout = function() {
            badge${index}.style.color = '#ccc';
            badge${index}.style.background = 'rgba(30,30,30,0.85)';
            badge${index}.style.transform = 'scale(1)';
          };

          badge${index}.onclick = function() {
            badge${index}.style.cursor = 'wait';
            if (badge${index}.dataset.sent === "1") return;
            badge${index}.textContent = ${JSON.stringify(t(settings.language, "report_sending"))};
            
            var appName = document.querySelector('.apphub_AppName');
            var name = appName ? appName.textContent.trim() : "Unknown";
            
            var devNodes = document.querySelectorAll('.dev_row a');
            var devs = [];
            devNodes.forEach(function(n) { devs.push(n.textContent.trim()); });
            var developer = devs.join(", ") || "Unknown";
            
            var data = {
              appid: String(${JSON.stringify(chip.appid)}),
              name: name.substring(0, 199),
              developer: developer.substring(0, 199),
              timestamp: Date.now()
            };
            
            console.debug("VARTA_REPORT:" + JSON.stringify({ data: data }));
          };
          containerL.appendChild(badge${index});
        `;
      } else if (chip.isIcon) {
        const isLarge = Boolean(chip.isLargeIcon);
        script += `
          var badge${index} = document.createElement('img');
          badge${index}.src = ${JSON.stringify(chip.iconSrc)};
          badge${index}.style.cssText = [
            ${isLarge ? "'width: 200px'" : "'width: 56px'"},
            ${isLarge ? "'height: auto'" : "'height: 56px'"},
            'filter: drop-shadow(0 4px 12px rgba(0,0,0,0.5))',
            'pointer-events: none',
            ${isLarge ? "'margin-bottom: 8px'" : "'border-radius: 4px'"}
          ].join(';');
          if (${isLarge}) {
            containerTextR.appendChild(badge${index});
          } else {
            containerIconsR.appendChild(badge${index});
          }
        `;
      } else {
        script += `
          var badge${index} = document.createElement('div');
          badge${index}.textContent = ${JSON.stringify(chip.label || "")};
          badge${index}.style.cssText = [
            'box-sizing: border-box',
            'max-width: min(360px, calc(100vw - 44px))',
            'padding: ' + ${JSON.stringify(chip.padding || '6px 14px')},
            'border-radius: 8px',
            'border: 1px solid ${chip.border || 'rgba(255,255,255,0.2)'}',
            'background: ${chip.background || 'rgba(30,30,30,0.85)'}',
            'box-shadow: 0 10px 28px ${chip.shadow || 'rgba(0,0,0,0.5)'}',
            'color: #fff',
            'font-family: Motiva Sans, Arial, sans-serif',
            'font-size: ' + ${JSON.stringify(chip.fontSize || '15px')},
            'font-weight: ' + ${JSON.stringify(chip.fontWeight || '700')},
            'line-height: ' + ${JSON.stringify(chip.lineHeight || '18px')},
            'letter-spacing: 0',
            'text-align: center',
            'white-space: normal',
            'overflow-wrap: anywhere',
            'pointer-events: none'
          ].join(';');

          if (${Boolean(chip.isReport)}) {
            containerL.appendChild(badge${index});
          } else {
            containerTextR.appendChild(badge${index});
          }
        `;
      }
    });
    
    script += `
      })();
    `;

    console.log("VARTA: executing script:", script);
    evaluateInStore(script);
  } catch (err) {
    reportError(err, "injectBadgeIntoStore");
  }
}

export function refreshStorePatch() {
  if (currentAppid && isStoreMounted) {
    injectBadgeIntoStore(currentAppid);
  }
}

async function connectToStoreDebugger(retries = 5) {
  console.log("VARTA: connectToStoreDebugger called, retries=", retries, "isStoreMounted=", isStoreMounted);
  if (retries <= 0 || !isStoreMounted) return;

  if (storeWebSocket) {
    storeWebSocket.close();
    storeWebSocket = null;
  }
  wsReady = false;

  try {
    const debuggerUrl = await getCefDebuggerUrl().catch(() => "http://localhost:8080/json");
    console.log("VARTA: fetchNoCors to debuggerUrl:", debuggerUrl);
    const tabsRes = await fetchNoCors(debuggerUrl);
    console.log("VARTA: tabsRes.ok:", tabsRes.ok);
    if (!tabsRes.ok) return;
    const tabs = await tabsRes.json() as SteamWebTab[];
    console.log("VARTA: tabs from debugger:", tabs.map(t => t.url));

    const storeTab = tabs.find(
      (t: SteamWebTab) => t.url && t.url.includes("store.steampowered.com") && !t.url.includes("checkout")
    );
    
    console.log("VARTA: Found storeTab:", storeTab?.url, storeTab?.webSocketDebuggerUrl);

    if (!storeTab || !storeTab.webSocketDebuggerUrl) {
      console.log("VARTA: No store tab found, retrying...");
      connectTimeoutId = window.setTimeout(() => void connectToStoreDebugger(retries - 1), 1000);
      return;
    }

    storeWebSocket = new WebSocket(storeTab.webSocketDebuggerUrl);

    storeWebSocket.onopen = (event) => {
      console.log("VARTA: storeWebSocket onopen");
      const ws = event.target as WebSocket;
      ws.send(JSON.stringify({ id: messageId++, method: "Page.enable" }));
      ws.send(JSON.stringify({ id: messageId++, method: "Runtime.enable" }));

      window.setTimeout(() => {
        wsReady = true;
        console.log("VARTA: wsReady=true, currentAppid=", currentAppid, "isStoreMounted=", isStoreMounted);
        if (currentAppid && isStoreMounted) {
          injectBadgeIntoStore(currentAppid);
        }
      }, 300);
    };

    storeWebSocket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        
        // Handle navigation via CEF debugger
        const url = msg?.params?.frame?.url;
        if (msg?.method === "Page.frameNavigated" && typeof url === "string") {
          window.setTimeout(() => {
            const match = url.match(/\/app\/(\d+)\/?/);
            const newAppid = match ? match[1] : "";
            if (newAppid !== currentAppid) {
              currentAppid = newAppid;
              if (currentAppid) {
                injectBadgeIntoStore(currentAppid);
              } else {
                removeBadgeFromStore();
              }
            }
          }, 500);
        } else if (msg?.method === "Runtime.consoleAPICalled") {
          const args = msg?.params?.args;
          if (args && args.length > 0 && args[0].type === "string" && args[0].value.startsWith("VARTA_REPORT:")) {
            try {
              const payload = JSON.parse(args[0].value.substring("VARTA_REPORT:".length));
              
              let steamId = "unknown";
              try {
                const anyWindow = window as any;
                if (anyWindow.App?.m_CurrentUser?.strSteamID) {
                  steamId = anyWindow.App.m_CurrentUser.strSteamID;
                } else if (typeof anyWindow.SteamClient !== "undefined" && anyWindow.SteamClient.User && anyWindow.SteamClient.User.GetSteamID) {
                  steamId = anyWindow.SteamClient.User.GetSteamID();
                } else if (anyWindow.g_steamID) {
                  steamId = anyWindow.g_steamID;
                }
              } catch (e) {}
              
              const pythonPayload = {
                  ...payload,
                  data: {
                      ...payload.data,
                      steamId: steamId
                  }
              };
              
              reportGameToPython(pythonPayload)
                .then((success) => {
                  if (success) {
                    evaluateInStore(`
                      var b = document.getElementById('varta-store-report-btn') || document.querySelector('#varta-store-badge-left > div');
                      if (b) {
                        b.textContent = ${JSON.stringify(t(currentSettingsGetter!().language, "report_sent"))};
                        b.style.cursor = 'default';
                        b.style.background = 'rgba(39, 174, 96, 0.9)';
                        b.dataset.sent = "1";
                        setTimeout(function() { b.remove(); }, 3000);
                      }
                    `);
                  } else {
                    evaluateInStore(`
                      var b = document.getElementById('varta-store-report-btn') || document.querySelector('#varta-store-badge-left > div');
                      if (b) {
                        b.textContent = ${JSON.stringify(t(currentSettingsGetter!().language, "report_error"))};
                        b.style.cursor = 'pointer';
                        b.style.background = 'rgba(192, 57, 43, 0.9)';
                        setTimeout(function() { b.textContent = ${JSON.stringify(t(currentSettingsGetter!().language, "report_btn"))}; b.style.background = 'rgba(30,30,30,0.85)'; }, 3000);
                      }
                    `);
                  }
                })
                .catch((e) => reportError(e, "reportGameToPython"));
            } catch (e) {
              reportError(e, "parse report payload");
            }
          }
        }
      } catch (err) {
        reportError(err, "storeWebSocket.onmessage");
      }
    };

    storeWebSocket.onerror = (e) => {
      console.error("Store WebSocket Error:", e);
    };

    storeWebSocket.onclose = () => {
      wsReady = false;
      storeWebSocket = null;
      if (isStoreMounted) {
        connectTimeoutId = window.setTimeout(connectToStoreDebugger, 2000);
      }
    };
    

  } catch (err) {
    reportError(err, "connectToStoreDebugger");
    if (isStoreMounted) {
      connectTimeoutId = window.setTimeout(connectToStoreDebugger, 2000);
    }
  }
}

export function initStorePatch(lookup: Lookup, getSettings: SettingsGetter) {
  currentLookup = lookup;
  currentSettingsGetter = getSettings;

  const handleLocationChange = (pathname: string) => {
    if (pathname === "/steamweb") {
      isStoreMounted = true;
      if (!storeWebSocket || storeWebSocket.readyState !== WebSocket.OPEN) {
        connectToStoreDebugger();
      }
    } else {
      isStoreMounted = false;
      if (storeWebSocket) {
        storeWebSocket.close();
        storeWebSocket = null;
      }
      wsReady = false;
      currentAppid = "";
      if (connectTimeoutId) {
        window.clearTimeout(connectTimeoutId);
        connectTimeoutId = undefined;
      }
    }
  };

  if (History) {
    historyUnlisten = History.listen((location: any) => {
      handleLocationChange(location.pathname);
    });
  }

  // Initial check
  window.setTimeout(() => {
    if (History && History.location) {
      handleLocationChange(History.location.pathname);
    }
  }, 1000);

  return () => {
    if (historyUnlisten) historyUnlisten();
    handleLocationChange("");
  };
}
