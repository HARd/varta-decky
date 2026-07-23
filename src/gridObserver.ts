import { getExtensions } from "./extensions/registry";
import type { AppStatus, PluginSettings } from "./types";

declare const g_PopupManager: any;

let observer: MutationObserver | null = null;
let currentSettings: () => PluginSettings;
let getAppStatus: (appid: string) => Promise<AppStatus>;
const processedImages = new WeakSet<HTMLImageElement>();

function getUIDocument(): Document | null {
  try {
    const popups = Array.from(g_PopupManager?.GetPopups?.() ?? []) as any[];
    const sp = popups.find(
      (p) => p?.m_strName?.startsWith("SP") && !p.m_strName.includes("Keyboard")
    );
    return sp?.m_popup?.document ?? null;
  } catch {
    return null;
  }
}

function parseAppId(src: string): string | undefined {
  if (!src) return undefined;
  if (!/library_(?:600x900|capsule|header)/.test(src)) return undefined;
  
  const byPath = src.match(/\/(?:assets|apps)\/(\d+)\//);
  if (byPath) return byPath[1];
  
  const legacy = src.match(/\/(\d+)_library_/);
  return legacy ? legacy[1] : undefined;
}

async function attachBadgeToImage(img: HTMLImageElement) {
  if (processedImages.has(img)) return;
  processedImages.add(img);

  const appid = parseAppId(img.src);
  if (!appid) return;

  const parent = img.parentElement;
  if (!parent) return;

  // Make sure parent can anchor absolutely positioned children
  if (window.getComputedStyle(parent).position === "static") {
    parent.style.position = "relative";
  }

  try {
    const status = await getAppStatus(appid);
    const settings = currentSettings();

    const chips = getExtensions()
      .map((ext) => ext.getStoreChips(status, settings))
      .flat()
      .filter((chip) => !chip.isReport); // Don't show report buttons on grid

    if (chips.length === 0) return;

    // Check if we already badged this parent
    if (parent.querySelector(".varta-grid-badge")) {
      return;
    }

    const container = parent.ownerDocument.createElement("div");
    container.className = "varta-grid-badge";
    
    // Position based on settings
    const pos = settings.libraryBadgePosition || "bottom-right";
    const posStyles: Partial<CSSStyleDeclaration> = {
      position: "absolute",
      zIndex: "10",
      display: "flex",
      flexDirection: "row",
      gap: "4px",
      pointerEvents: "none",
    };
    
    if (pos.includes("top")) {
      posStyles.top = "6px";
    } else {
      posStyles.bottom = "6px";
    }
    
    if (pos.includes("left")) {
      posStyles.left = "6px";
      posStyles.flexDirection = "row";
    } else {
      posStyles.right = "6px";
      posStyles.flexDirection = "row-reverse";
    }
    
    Object.assign(container.style, posStyles);

    chips.forEach((chip) => {
      if (chip.libraryIconSrc || chip.iconSrc) {
        const imgEl = parent.ownerDocument.createElement("img");
        imgEl.src = chip.libraryIconSrc || chip.iconSrc!;
        imgEl.style.cssText = "width: 28px; height: auto; filter: drop-shadow(0 4px 6px rgba(0,0,0,0.5));";
        container.appendChild(imgEl);
      } else if (chip.label) {
        const textEl = parent.ownerDocument.createElement("div");
        textEl.textContent = chip.label;
        textEl.style.cssText = `
          padding: 4px 8px;
          border-radius: 4px;
          background: ${chip.background || "rgba(0,0,0,0.8)"};
          color: #fff;
          font-size: 12px;
          font-weight: bold;
          white-space: nowrap;
          border: 1px solid ${chip.border || "transparent"};
          box-shadow: 0 4px 8px ${chip.shadow || "rgba(0,0,0,0.3)"};
        `;
        container.appendChild(textEl);
      }
    });

    parent.appendChild(container);
  } catch (err) {
    console.error("VARTA Grid Badge error:", err);
  }
}

function processMutations(mutations: MutationRecord[]) {
  for (const mutation of mutations) {
    if (mutation.type === "childList") {
      for (const node of mutation.addedNodes) {
        if (node instanceof HTMLImageElement) {
          attachBadgeToImage(node);
        } else if (node instanceof HTMLElement) {
          const images = node.querySelectorAll("img");
          images.forEach(attachBadgeToImage);
        }
      }
    } else if (mutation.type === "attributes" && mutation.target instanceof HTMLImageElement) {
      if (mutation.attributeName === "src") {
        processedImages.delete(mutation.target);
        attachBadgeToImage(mutation.target);
      }
    }
  }
}

let checkInterval: number;

export function initGridObserver(
  statusLookup: (appid: string) => Promise<AppStatus>,
  settingsGetter: () => PluginSettings
) {
  getAppStatus = statusLookup;
  currentSettings = settingsGetter;

  const attachObserver = () => {
    const doc = getUIDocument();
    if (!doc) return;

    if (observer) {
      observer.disconnect();
    }

    observer = new MutationObserver(processMutations);
    
    // Process existing images
    doc.querySelectorAll("img").forEach(attachBadgeToImage);
    
    observer.observe(doc.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["src"],
    });
  };

  attachObserver();
  checkInterval = window.setInterval(attachObserver, 5000); // Re-attach on UI restarts
}

export function stopGridObserver() {
  if (observer) {
    observer.disconnect();
    observer = null;
  }
  if (checkInterval) {
    window.clearInterval(checkInterval);
  }
  
  const doc = getUIDocument();
  if (doc) {
    doc.querySelectorAll(".varta-grid-badge").forEach((el) => el.remove());
  }
}
