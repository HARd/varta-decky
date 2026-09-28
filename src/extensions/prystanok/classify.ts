// Reads the raw AggregatedGameModel from the Prystanok backend.

export type ThreatLevel = "russian" | "suspect" | "vendor" | null;
export type LocKind = "audio" | "text" | "none";

export interface PrystanokVerdict {
  threatLevel: ThreatLevel;
  threatReasons: string[];
  vendorReasons: string[];
  loc: LocKind;
  official: boolean | null; // null = no KULI record: localization comes from Steam
  semiOfficial: boolean;
  ukrainian: boolean;
}

// Compare whole words: "SemiOfficial" contains "Official".
function splitFlags(value: unknown): Set<string> {
  if (typeof value !== "string") return new Set();
  return new Set(value.split(",").map((s) => s.trim()).filter(Boolean));
}

export function classify(raw: any): PrystanokVerdict | null {
  const kuli = raw?.KuliGame;
  const steam = raw?.SteamGame;
  if (!kuli && !steam) return null;

  const steamFlags = splitFlags(steam?.Localization);
  const kuliFlags = splitFlags(kuli?.Localization);
  const hasAny = (...names: string[]) => names.some((n) => steamFlags.has(n) || kuliFlags.has(n));

  const loc: LocKind = hasAny("Audio") ? "audio" : hasAny("Text", "Subtitles") ? "text" : "none";

  let official: boolean | null = null;
  let semiOfficial = false;
  if (kuliFlags.size > 0) {
    official = kuliFlags.has("Official");
    semiOfficial = kuliFlags.has("SemiOfficial") && !official;
  }

  //   russian - KULI says so, or the studio behind the game makes mostly russian games
  //   suspect - someone involved makes mostly russian games, usually the publisher
  //   vendor  - someone involved has a few russian games
  // Only this game's own developers count as "the studio", so a russian
  // publisher with a single dev credit doesn't turn the game russian.
  const threatReasons: string[] = [];
  const vendorReasons: string[] = [];
  const origin = kuli?.Origin;
  if (origin === "Russian") threatReasons.push("origin:Russian");

  const developers = new Set<string>(steam?.Metadata?.Developers ?? []);
  let russianDeveloper = false;
  let majorityVendor = false;
  for (const vendor of steam?.Vendors ?? []) {
    const rusDev = vendor.RussianGamesDeveloped || 0;
    const rus = (vendor.RussianGamesPublished || 0) + rusDev;
    if (rus === 0) continue;
    const totalDev = vendor.TotalGamesDeveloped || 0;
    const total = (vendor.TotalGamesPublished || 0) + totalDev;
    const share = total ? rus / total : 1;
    const devShare = totalDev ? rusDev / totalDev : 0;
    const desc = `${vendor.Name} (рос. ігор: ${rus}/${total})`;
    if (developers.has(vendor.Name) && rusDev > 0 && devShare > 0.5) {
      russianDeveloper = true;
      threatReasons.push(`developer:${desc}`);
    } else if (share > 0.5) {
      majorityVendor = true;
      threatReasons.push(`vendor:${desc}`);
    } else {
      vendorReasons.push(`vendor:${desc}`);
    }
  }

  let threatLevel: ThreatLevel = null;
  if (origin === "Russian" || russianDeveloper) threatLevel = "russian";
  else if (majorityVendor) threatLevel = "suspect";
  else if (vendorReasons.length) threatLevel = "vendor";

  return {
    threatLevel,
    threatReasons,
    vendorReasons,
    loc,
    official,
    semiOfficial,
    ukrainian: origin === "Ukrainian",
  };
}
