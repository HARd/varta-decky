import { useParams } from "@decky/ui";
import { useEffect, useState, useMemo } from "react";
import type { AppStatus, PluginSettings } from "./types";
import { getExtensions } from "./extensions/registry";

type Props = {
  lookup: (appid: string) => Promise<AppStatus>;
  getSettings: () => PluginSettings;
  placement?: "library" | "store";
};

export default function GamePageBadge({ lookup, getSettings, placement = "library" }: Props) {
  const { appid } = useParams<{ appid: string }>();
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [settings, setLocalSettings] = useState(getSettings());

  useEffect(() => {
    const listener = () => setLocalSettings(getSettings());
    window.addEventListener("varta-settings-changed", listener);
    return () => window.removeEventListener("varta-settings-changed", listener);
  }, [getSettings]);

  useEffect(() => {
    let cancelled = false;
    setStatus(null);
    if (!appid) return;

    void lookup(appid).then((nextStatus) => {
      if (!cancelled) setStatus(nextStatus);
    });

    return () => {
      cancelled = true;
    };
  }, [appid, lookup]);

  const { containerStyle } = useMemo(() => {
    const pStyles = getLibraryPositionStyles(settings.libraryBadgePosition);
    return {
      positionStyles: pStyles,
      containerStyle: placement === "store" ? storeContainerStyle : { ...libraryContainerStyle, ...pStyles }
    };
  }, [settings.libraryBadgePosition, placement]);

  if (!status) return null;

  const chips = getExtensions()
    .map(ext => ext.getStoreChips(status, settings))
    .flat()
    .filter(chip => !chip.isReport); // For now, only visual badges on library page

  if (chips.length === 0) return null;

  return (
    <div style={containerStyle}>
      {chips.map((chip, idx) => {
        if (settings.libraryBadgeStyle === "icon" || chip.isIcon) {
          const iconSrc = chip.libraryIconSrc || chip.iconSrc;
          if (iconSrc) {
            return (
              <img 
                key={idx}
                src={iconSrc} 
                alt={chip.label} 
                title={chip.label}
                style={{ width: "48px", height: "auto", filter: "drop-shadow(0 4px 12px rgba(0,0,0,0.6))" }} 
              />
            );
          }
        }
        
        const color = chip.background || (chip.type === "hostile" ? settings.hostileColor : settings.ukrainianColor);
        const iconSrc = chip.libraryIconSrc || chip.iconSrc;
        return (
            <div 
              key={idx}
              style={{
                background: color,
                color: "#fff",
                padding: "6px 12px 6px 8px",
                borderRadius: "8px",
                fontFamily: "Motiva Sans, Arial, sans-serif",
                fontSize: "12px",
                fontWeight: "bold",
                display: "flex",
                alignItems: "center",
                gap: "6px",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              }}
              title={chip.label}
            >
              {iconSrc && (
                <img 
                  src={iconSrc} 
                  style={{ height: "22px", width: "auto", display: "block", filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.3))" }} 
                  alt="" 
                />
              )}
              <span>{chip.label}</span>
            </div>
          );
      })}
    </div>
  );
}

function getLibraryPositionStyles(pos: string) {
  const base: any = { display: "flex", flexDirection: "column", gap: "8px" };
  switch (pos) {
    case "top-left":
      return { ...base, alignItems: "flex-start", top: "58px", left: "22px", right: "auto" };
    case "top-right":
      return { ...base, alignItems: "flex-end", top: "58px", right: "22px", left: "auto" };
    case "bottom-left":
      return { ...base, alignItems: "flex-start", top: "135px", left: "22px", right: "auto" };
    case "bottom-right":
    default:
      return { ...base, alignItems: "flex-end", top: "135px", right: "22px", left: "auto" };
  }
}

const libraryContainerStyle = {
  position: "absolute",
  zIndex: 20,
  pointerEvents: "none",
} as const;

const storeContainerStyle = {
  position: "fixed",
  top: "72px",
  right: "92px",
  zIndex: 999999,
  pointerEvents: "none",
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  alignItems: "flex-end",
} as const;
