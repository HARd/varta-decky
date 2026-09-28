import {
  PanelSection,
  PanelSectionRow,
  ToggleField,
} from "@decky/ui";
import type { VartaExtension, ChipPayload } from "../types";
import {
  PrystanokCCIcon,
  PrystanokCCSpeakerIcon,
  PrystanokHandIcon,
  PrystanokTriangleIcon,
  PrystanokShieldIcon
} from "../../icons";
import { classify } from "./classify";

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
            checked={settings.showPrystanokLoc ?? true}
            onChange={(checked) => setSetting("showPrystanokLoc", checked)}
          />
        </PanelSectionRow>
        <PanelSectionRow>
          <ToggleField
            label="Детальні бейджі"
            description="Показувати додаткові іконки типу локалізації та детальні описи"
            checked={settings.detailedPrystanokBadges ?? true}
            onChange={(checked) => setSetting("detailedPrystanokBadges", checked)}
          />
        </PanelSectionRow>
      </PanelSection>
    );
  },

  getStoreChips: (status, settings) => {
    const chips: ChipPayload[] = [];
    const verdict = classify((status as any)?.prystanok);
    if (!verdict) return chips;

    const detailed = settings.detailedPrystanokBadges ?? true;
    const isIcon = settings.libraryBadgeStyle === "icon";

    // Threats are shown even with localization badges turned off.
    if (verdict.threatLevel === "russian") {
      chips.push({
        type: "hostile",
        label: "Російська гра",
        isIcon,
        iconSrc: PrystanokHandIcon,
        libraryIconSrc: PrystanokHandIcon,
        background: "rgba(192, 57, 43, 0.9)",
      });
      return chips; // no point advertising the localization of a russian game
    }
    if (verdict.threatLevel === "suspect") {
      chips.push({
        type: "hostile",
        label: detailed ? "Ймовірно сумнівна гра" : "Сумнівна",
        isIcon,
        iconSrc: PrystanokTriangleIcon,
        libraryIconSrc: PrystanokTriangleIcon,
        background: "rgba(192, 57, 43, 0.9)",
      });
    } else if (verdict.threatLevel === "vendor") {
      chips.push({
        type: "hostile",
        label: detailed ? "Видавець видавав рос. ігри" : "Видавець",
        isIcon,
        iconSrc: PrystanokShieldIcon,
        libraryIconSrc: PrystanokShieldIcon,
        background: "rgba(230, 126, 34, 0.9)",
        fontSize: "13px",
        padding: "4px 10px",
        lineHeight: "15px",
      });
    }

    if ((settings.showPrystanokLoc ?? true) && verdict.loc !== "none") {
      const audio = verdict.loc === "audio";
      let label = "🇺🇦";
      if (detailed) {
        // not in KULI means the localization is Steam's own, so it's official
        label = verdict.official !== false
          ? "🇺🇦 Офіційна"
          : verdict.semiOfficial ? "🇺🇦 Напівофіційна" : "🇺🇦 Українізатор";
        label += audio ? " (Текст і озвучка)" : " (Текст)";
      }
      const icon = audio ? PrystanokCCSpeakerIcon : PrystanokCCIcon;
      chips.push({
        type: "ukrainian",
        label,
        isIcon,
        iconSrc: icon,
        libraryIconSrc: icon,
        background: "rgba(18, 59, 107, 0.9)",
        border: "rgba(255, 203, 51, 0.5)",
      });
    }

    return chips;
  }
};

export default PrystanokExtension;
