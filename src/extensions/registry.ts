import type { ReactElement } from "react";
import type { PluginSettings, AppStatus } from "../types";

export interface ChipPayload {
  label?: string;
  isIcon?: boolean;
  iconSrc?: string;
  libraryIconSrc?: string;
  background?: string;
  border?: string;
  shadow?: string;
  fontSize?: string;
  padding?: string;
  lineHeight?: string;
  fontWeight?: string;
  isReport?: boolean;
  appid?: string;
  type?: string;
  isLargeIcon?: boolean;
  remoteDatabaseUrl?: string;
}

export interface VartaExtension {
  id: string;
  name: string;
  renderSettings: (props: {
    settings: PluginSettings;
    setSetting: (key: keyof PluginSettings, value: any) => void;
    lang: "uk" | "en";
    getAppStatus: (appid: string) => Promise<AppStatus>;
  }) => ReactElement | null;
  
  getStoreChips: (status: AppStatus, settings: PluginSettings) => ChipPayload[];
}

const registry: VartaExtension[] = [];

export function registerExtension(ext: VartaExtension) {
  registry.push(ext);
}

export function getExtensions() {
  return registry;
}
