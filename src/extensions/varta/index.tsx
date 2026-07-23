import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
  SliderField,
  DropdownItem,
} from "@decky/ui";
import { t } from "../../i18n";
import { WishlistScanner } from "../../WishlistScanner";
import type { VartaExtension, ChipPayload } from "../types";
import { HostileStoreIcon, UkrStoreIcon, HostileLibraryIcon, UkrLibraryIcon } from "../../icons";

function getColorOptions(lang: "uk" | "en") {
  return [
    { data: "#e74c3c", label: t(lang, "color_red") },
    { data: "#7a2a2a", label: t(lang, "color_darkred") },
    { data: "#e67e22", label: t(lang, "color_orange") },
    { data: "#f1c40f", label: t(lang, "color_yellow") },
    { data: "#27ae60", label: t(lang, "color_green") },
    { data: "#2980b9", label: t(lang, "color_blue") },
    { data: "#8e44ad", label: t(lang, "color_purple") },
    { data: "#2c3e50", label: t(lang, "color_darkblue") },
    { data: "#bdc3c7", label: t(lang, "color_gray") },
  ];
}

function getPositionOptions(lang: "uk" | "en") {
  return [
    { data: "top-left", label: t(lang, "pos_tl") },
    { data: "top-right", label: t(lang, "pos_tr") },
    { data: "bottom-left", label: t(lang, "pos_bl") },
    { data: "bottom-right", label: t(lang, "pos_br") },
  ];
}

function getStyleOptions(lang: "uk" | "en") {
  return [
    { data: "text", label: t(lang, "style_text") },
    { data: "icon", label: t(lang, "style_icon") },
  ];
}

const VartaCoreExtension: VartaExtension = {
  id: "varta",
  name: "VARTA",
  
  renderSettings: ({ settings, setSetting, lang, getAppStatus }) => {
    return (
      <>
        <PanelSection title={t(lang, "section_ui")}>
          <PanelSectionRow>
            <DropdownItem
              menuLabel={t(lang, "menu_language")}
              rgOptions={[
                { data: "uk", label: "Українська" },
                { data: "en", label: "English" },
              ]}
              selectedOption={settings.language}
              onChange={(option) => setSetting("language", option.data)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={t(lang, "menu_hostile_dev")}
              checked={settings.markHostile}
              onChange={(checked) => setSetting("markHostile", checked)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={t(lang, "menu_ukrainian_dev")}
              checked={settings.markUkrainian}
              onChange={(checked) => setSetting("markUkrainian", checked)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={t(lang, "menu_show_badges")}
              checked={settings.showBadges}
              onChange={(checked) => setSetting("showBadges", checked)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={t(lang, "menu_show_report")}
              checked={settings.showReportButton}
              onChange={(checked) => setSetting("showReportButton", checked)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <SliderField
              label={t(lang, "menu_overlay_opacity")}
              description={`${Math.round(settings.overlayOpacity * 100)}%`}
              value={settings.overlayOpacity}
              min={0.05}
              max={1}
              step={0.05}
              onChange={(value) => setSetting("overlayOpacity", value)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <div style={{ padding: "10px 0 5px 0", fontSize: "12px", color: "#969696", textTransform: "uppercase", fontWeight: 600 }}>{t(lang, "menu_hostile_color")}</div>
            <DropdownItem
              menuLabel={t(lang, "menu_hostile_color")}
              rgOptions={getColorOptions(lang)}
              selectedOption={settings.hostileColor}
              onChange={(option) => setSetting("hostileColor", option.data)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <div style={{ padding: "10px 0 5px 0", fontSize: "12px", color: "#969696", textTransform: "uppercase", fontWeight: 600 }}>{t(lang, "menu_ukrainian_color")}</div>
            <DropdownItem
              menuLabel={t(lang, "menu_ukrainian_color")}
              rgOptions={getColorOptions(lang)}
              selectedOption={settings.ukrainianColor}
              onChange={(option) => setSetting("ukrainianColor", option.data)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <div style={{ padding: "10px 0 5px 0", fontSize: "12px", color: "#969696", textTransform: "uppercase", fontWeight: 600 }}>{t(lang, "menu_badge_position")}</div>
            <DropdownItem
              menuLabel={t(lang, "menu_badge_position")}
              rgOptions={getPositionOptions(lang)}
              selectedOption={settings.libraryBadgePosition}
              onChange={(option) => setSetting("libraryBadgePosition", option.data)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <div style={{ padding: "10px 0 5px 0", fontSize: "12px", color: "#969696", textTransform: "uppercase", fontWeight: 600 }}>{t(lang, "menu_badge_style")}</div>
            <DropdownItem
              menuLabel={t(lang, "menu_badge_style")}
              rgOptions={getStyleOptions(lang)}
              selectedOption={settings.libraryBadgeStyle}
              onChange={(option) => setSetting("libraryBadgeStyle", option.data)}
            />
          </PanelSectionRow>
          <PanelSectionRow>
            <ToggleField
              label={t(lang, "menu_analytics")}
              description={t(lang, "menu_analytics_desc")}
              checked={settings.analyticsEnabled}
              onChange={(checked) => setSetting("analyticsEnabled", checked)}
            />
          </PanelSectionRow>
        </PanelSection>
        
        <WishlistScanner getAppStatus={getAppStatus} lang={lang} />
      </>
    );
  },

  getStoreChips: (status, settings) => {
    const chips: ChipPayload[] = [];
    if (!status) return chips;
    
    const vartaStatus = (status as any).varta;
    
    if (settings.showReportButton && (!vartaStatus || !vartaStatus.type)) {
      chips.push({
        isReport: true,
        appid: status.appid,
        remoteDatabaseUrl: settings.remoteDatabaseUrl
      });
    }

    if (!vartaStatus) return chips;

    if (vartaStatus.type === "in_review") {
      chips.push({ type: "in_review", label: "⏳ На розгляді" });
      return chips;
    }

    if (!settings.showBadges) return chips;
    if (vartaStatus.type === "hostile" && !settings.markHostile) return chips;
    if (vartaStatus.type === "ukrainian" && !settings.markUkrainian) return chips;

    const isHostile = vartaStatus.type === "hostile";
    chips.push({
      label: isHostile ? "Ворожий проект" : "Дружній проект",
      background: isHostile ? settings.hostileColor : settings.ukrainianColor,
      border: isHostile ? "rgba(255, 190, 190, .65)" : "rgba(200, 255, 220, .65)",
      shadow: isHostile ? "rgba(122, 42, 42, .45)" : "rgba(39, 174, 96, .38)",
      isIcon: settings.libraryBadgeStyle === "icon",
      isLargeIcon: settings.libraryBadgeStyle === "icon",
      iconSrc: isHostile ? HostileStoreIcon : UkrStoreIcon,
      libraryIconSrc: isHostile ? HostileLibraryIcon : UkrLibraryIcon,
    });
    
    return chips;
  }
};

export default VartaCoreExtension;
