import { beforePatch, findModule, findModuleByExport } from "@decky/ui";
import { Component, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { getExtensions } from "./extensions/registry";
import type { AppStatus, PluginSettings } from "./types";

type Lookup = (appid: string) => Promise<AppStatus>;
type SettingsGetter = () => PluginSettings;

const REACT_MEMO = Symbol.for("react.memo");

// Steam's library capsule (navKey "appportrait_<appid>") is a mobx observer, i.e. a React.memo whose
// wrapper hides the source. Find its module via a sibling export, then take the module's only memo export.
function findLibraryTile(): any {
  const mod = findModuleByExport(
    (e: any) => typeof e === "function" && String(e).includes("GetELibraryDisplaySizeForWidth"),
  );
  const memos = mod ? Object.values(mod).filter((e: any) => e?.$$typeof === REACT_MEMO) : [];
  return memos.length === 1 ? memos[0] : null;
}

const BADGE_CLASS = "varta-tile-badge";
let active = false;
let followFocusCss = "";

// Our badge is a DOM sibling of the cover (.LibraryItemBox), so it can follow the cover's focus/hover
// "lift" the same way Steam's own subscript does (translateZ inside the tile's perspective).
function buildFollowFocusCss(): string {
  const c = findModule((m: any) => typeof m === "object" && m?.LibraryItemBox && m?.Draggable && m?.Landscape);
  if (!c) return "";
  const lifted = (extra = "") =>
    `.${c.LibraryItemBox}${extra}.gpfocus ~ .${BADGE_CLASS}, .${c.LibraryItemBox}${extra}:hover ~ .${BADGE_CLASS}`;
  return `
    .${BADGE_CLASS} { transition: transform .3s cubic-bezier(0.16, 0.86, 0.43, 0.99); }
    ${lifted()} { transform: translateZ(15px); }
    ${lifted(`.${c.Landscape}`)} { transform: translateZ(7px); }
  `;
}

export function patchLibraryTiles(lookup: Lookup, getSettings: SettingsGetter): () => void {
  const Tile = findLibraryTile();
  if (!Tile) {
    console.warn("[VARTA] library tile component not found, grid badges disabled");
    return () => {};
  }

  active = true;
  followFocusCss = buildFollowFocusCss();
  // The tile renders props.children inside its own positioned wrapper, so we only add a child.
  const patch = beforePatch(Tile, "type", (args: any[]) => {
    const props = args[0];
    const app = props?.app;
    // Tiles mounted before unpatching keep calling this wrapper until they remount.
    if (!active || !app?.appid || app.BIsModOrShortcut?.()) return;
    args[0] = {
      ...props,
      children: [
        props.children,
        <SilentBoundary key="varta-tile-badge">
          <TileBadge appid={String(app.appid)} lookup={lookup} getSettings={getSettings} />
        </SilentBoundary>,
      ],
    };
  });

  return () => {
    active = false;
    patch.unpatch();
  };
}

function TileBadge({ appid, lookup, getSettings }: { appid: string; lookup: Lookup; getSettings: SettingsGetter }) {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [settings, setSettings] = useState(getSettings);

  useEffect(() => {
    const listener = () => setSettings(getSettings());
    window.addEventListener("varta-settings-changed", listener);
    return () => window.removeEventListener("varta-settings-changed", listener);
  }, [getSettings]);

  useEffect(() => {
    let cancelled = false;
    lookup(appid)
      .then((next) => { if (!cancelled) setStatus(next); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [appid, lookup]);

  if (!status) return null;
  const chips = getExtensions()
    .flatMap((ext) => ext.getStoreChips(status, settings))
    .filter((chip) => !chip.isReport);
  if (chips.length === 0) return null;

  const pos = settings.libraryBadgePosition || "bottom-right";
  const left = pos.includes("left");
  return (
    <div
      className={BADGE_CLASS}
      style={{
        position: "absolute",
        zIndex: 13, // a focused/hovered cover jumps to z-index 12; Steam's own subscript uses 13 too
        display: "flex",
        flexDirection: left ? "row" : "row-reverse",
        gap: "4px",
        pointerEvents: "none",
        ...(pos.includes("top") ? { top: "6px" } : { bottom: "6px" }),
        ...(left ? { left: "6px" } : { right: "6px" }),
      }}
    >
      {followFocusCss && <style>{followFocusCss}</style>}
      {chips.map((chip, idx) => {
        const iconSrc = chip.libraryIconSrc || chip.iconSrc;
        if (iconSrc) {
          return (
            <img
              key={idx}
              src={iconSrc}
              alt={chip.label}
              style={{ width: "28px", height: "auto", filter: "drop-shadow(0 4px 6px rgba(0,0,0,0.5))" }}
            />
          );
        }
        return (
          <div
            key={idx}
            style={{
              padding: "4px 8px",
              borderRadius: "4px",
              background: chip.background || "rgba(0,0,0,0.8)",
              color: "#fff",
              fontSize: "12px",
              fontWeight: "bold",
              whiteSpace: "nowrap",
              border: `1px solid ${chip.border || "transparent"}`,
              boxShadow: `0 4px 8px ${chip.shadow || "rgba(0,0,0,0.3)"}`,
            }}
          >
            {chip.label}
          </div>
        );
      })}
    </div>
  );
}

// A badge error must never take down Steam's library grid.
class SilentBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("[VARTA] tile badge crashed", error);
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
