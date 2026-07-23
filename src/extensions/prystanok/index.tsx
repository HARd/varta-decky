import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
} from "@decky/ui";
import type { VartaExtension, ChipPayload } from "../types";
import { 
  PrystanokCCIcon, 
  PrystanokSpeakerIcon, 
  PrystanokCCSpeakerIcon, 
  PrystanokHandIcon,
  PrystanokTriangleIcon,
  PrystanokShieldIcon
} from "../../icons";

const PrystanokExtension: VartaExtension = {
  id: "prystanok",
  name: "Prystanok",
  
  renderSettings: ({ settings, setSetting }) => {
    return (
      <PanelSection title="Prystanok (Пристанок)">
        <PanelSectionRow>
          <ToggleField
            label="Показувати українську локалізацію"
            description="Відмальовувати бейджі для ігор з українською локалізацією"
            checked={settings.showPrystanokLoc}
            onChange={(checked) => setSetting("showPrystanokLoc", checked)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Детальні бейджі"
            description="Показувати додаткові іконки типу локалізації та детальні описи"
            checked={settings.detailedPrystanokBadges}
            onChange={(checked) => setSetting("detailedPrystanokBadges", checked)}
          />
        </PanelSectionRow>
      </PanelSection>
    );
  },

  getStoreChips: (status, settings) => {
    const chips: ChipPayload[] = [];
    if (!status) return chips;
    
    const prystanokStatus = (status as any).prystanok;
    
    if (!settings.showPrystanokLoc) return chips;
    if (!prystanokStatus) return chips;

    const kuli = prystanokStatus.KuliGame;
    
    // Check hostile first
    if (kuli && kuli.Descriptor === "Russian") {
      chips.push({
        type: "hostile",
        label: "Російська гра",
        isIcon: settings.libraryBadgeStyle === "icon",
        iconSrc: PrystanokHandIcon,
        libraryIconSrc: PrystanokHandIcon,
        background: "rgba(192, 57, 43, 0.9)",
      });
      return chips; // Prystanok logic says Russian overwrites everything
    } else if (kuli && kuli.Descriptor === "Suspect") {
      chips.push({
        type: "hostile",
        label: settings.detailedPrystanokBadges ? "Підозріла гра / Видавець" : "Підозріла",
        isIcon: settings.libraryBadgeStyle === "icon",
        iconSrc: PrystanokTriangleIcon,
        libraryIconSrc: PrystanokTriangleIcon,
        background: "rgba(230, 126, 34, 0.9)",
      });
    }

    if (kuli && kuli.Localization) {
      const loc = kuli.Localization as string;
      const isOfficial = loc.includes("Official");
      const isSemiOfficial = loc.includes("SemiOfficial");
      
      const hasAudio = loc.includes("Audio");
      const hasText = loc.includes("Text");
      
      let label = "🇺🇦";
      if (settings.detailedPrystanokBadges) {
        label = isOfficial ? "🇺🇦 Офіційна" : (isSemiOfficial ? "🗣️ КУЛІ" : "🇺🇦 Локалізація");
        if (hasAudio && hasText) {
          label += " (Текст і Озвучка)";
        } else if (hasAudio) {
          label += " (Озвучка)";
        } else if (hasText) {
          label += " (Текст)";
        }
      }
      
      let iconToUse = PrystanokCCIcon;
      
      if (hasAudio && hasText) {
        iconToUse = PrystanokCCSpeakerIcon;
      } else if (hasAudio) {
        iconToUse = PrystanokSpeakerIcon;
      } else if (hasText) {
        iconToUse = PrystanokCCIcon;
      }

      chips.push({
        type: "ukrainian",
        label: label,
          isIcon: settings.libraryBadgeStyle === "icon",
        iconSrc: iconToUse,
        libraryIconSrc: iconToUse,
        background: "rgba(18, 59, 107, 0.9)",
        border: "rgba(255, 203, 51, 0.5)",
      });
    }
    
    // Check vendor risk from SteamGame.Vendors
    const steamGame = prystanokStatus.SteamGame;
    if (steamGame && steamGame.Vendors) {
      let maxRussianPct = 0;
      for (const vendor of steamGame.Vendors) {
        const total = (vendor.TotalGamesPublished || 0) + (vendor.TotalGamesDeveloped || 0);
        const russian = (vendor.RussianGamesPublished || 0) + (vendor.RussianGamesDeveloped || 0);
        if (total > 0 && russian > 0) {
          const pct = russian / total;
          if (pct > maxRussianPct) {
            maxRussianPct = pct;
          }
        }
      }
      
      // If we haven't already marked it as hostile/suspect and vendor has russian games
      if (maxRussianPct > 0 && chips.filter(c => c.type === "hostile").length === 0) {
        chips.push({
          type: "hostile",
          label: settings.detailedPrystanokBadges 
            ? (maxRussianPct > 0.5 ? "Видавець мажоритарно рос. ігор" : "Видавець видавав рос. ігри") 
            : "Видавець",
          isIcon: settings.libraryBadgeStyle === "icon",
          iconSrc: maxRussianPct > 0.5 ? PrystanokTriangleIcon : PrystanokShieldIcon,
          libraryIconSrc: maxRussianPct > 0.5 ? PrystanokTriangleIcon : PrystanokShieldIcon,
          background: "rgba(230, 126, 34, 0.9)",
          fontSize: "13px",
          padding: "4px 10px",
          lineHeight: "15px",
        });
      }
    }
    
    return chips;
  }
};

export default PrystanokExtension;
