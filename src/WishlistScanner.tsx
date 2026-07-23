import {
  ButtonItem,
  Field,
  PanelSection,
  PanelSectionRow,
  Spinner
} from "@decky/ui";
import { toaster } from "@decky/api";
import { FC, useState } from "react";
import { callable } from "@decky/api";
import { AppStatus } from "./types";
import { t, Language } from "./i18n";

const trackEvent = callable<[event: string, properties?: Record<string, any>], boolean>("track_event");

interface WishlistScannerProps {
  getAppStatus: (appid: string) => Promise<AppStatus>;
  lang: Language;
}

export const WishlistScanner: FC<WishlistScannerProps> = ({ getAppStatus, lang }) => {
  const [isScanning, setIsScanning] = useState(false);
  const [scannedCount, setScannedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hostileGames, setHostileGames] = useState<AppStatus[]>([]);
  const [scanComplete, setScanComplete] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const scanWishlist = async () => {
    setIsScanning(true);
    setScanComplete(false);
    setScannedCount(0);
    setTotalCount(0);
    setHostileGames([]);

    try {
      const res = await fetch(`https://store.steampowered.com/dynamicstore/userdata/?_=${Date.now()}`, {
        credentials: "include",
        cache: "no-store"
      });
      const data = await res.json();
      
      const appids: number[] = data.rgWishlist || [];
      setTotalCount(appids.length);

      const foundHostiles: AppStatus[] = [];

      const CHUNK_SIZE = 10;
      let completed = 0;

      for (let i = 0; i < appids.length; i += CHUNK_SIZE) {
        const chunk = appids.slice(i, i + CHUNK_SIZE);
        await Promise.all(
          chunk.map(async (numAppid) => {
            const appid = String(numAppid);
            const status = await getAppStatus(appid);
            
            const vartaStatus = (status as any).varta;
            if (vartaStatus && vartaStatus.type === "hostile") {
              foundHostiles.push(status);
            }
            completed++;
            setScannedCount(completed);
          })
        );
        // Оновлюємо стан після кожного чанка, щоб не перевантажувати React
        setHostileGames([...foundHostiles]);
      }
      
      setScanComplete(true);
      void trackEvent("wishlist_scanned", {
        total: appids.length,
        hostile_found: foundHostiles.length,
      }).catch(() => {});
    } catch (e) {
      console.error("Failed to scan wishlist", e);
    } finally {
      setIsScanning(false);
    }
  };

  const removeHostileGames = async () => {
    setIsDeleting(true);
    try {
      const win = window as any;
      
      // 1. Try native Steam API first
      if (win.SteamClient?.Store?.SetWishlist) {
        for (const game of hostileGames) {
          await win.SteamClient.Store.SetWishlist(parseInt(game.appid), false);
        }
        setHostileGames([]);
        toaster.toast({ title: "Успіх", body: "Ігри видалено через Steam API!", duration: 4000 });
        setIsDeleting(false);
        return;
      }
      if (win.SteamClient?.StoreItems?.SetWishlist) {
        for (const game of hostileGames) {
          await win.SteamClient.StoreItems.SetWishlist(parseInt(game.appid), false);
        }
        setHostileGames([]);
        toaster.toast({ title: "Успіх", body: "Ігри видалено через StoreItems API!", duration: 4000 });
        setIsDeleting(false);
        return;
      }

      toaster.toast({
        title: "Помилка",
        body: "Не знайдено нативних API SteamClient для видалення ігор.",
        duration: 4000,
      });
    } catch (e: any) {
      console.error("Failed to remove games", e);
      toaster.toast({
        title: "Помилка",
        body: "Не вдалося видалити: " + (e.message || String(e)),
        duration: 4000,
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <PanelSection title={t(lang, "section_wishlist")}>
      <PanelSectionRow>
        <ButtonItem
          layout="below"
          onClick={scanWishlist}
          disabled={isScanning || isDeleting}
        >
          {isScanning ? t(lang, "wishlist_scanning", { c: scannedCount, t: totalCount }) : t(lang, "wishlist_scan")}
        </ButtonItem>
      </PanelSectionRow>

      {isScanning && (
        <PanelSectionRow>
          <div style={{ display: "flex", justifyContent: "center", padding: "10px" }}>
            <Spinner />
          </div>
        </PanelSectionRow>
      )}

      {scanComplete && hostileGames.length === 0 && (
        <PanelSectionRow>
          <Field description="">{t(lang, "wishlist_clean")}</Field>
        </PanelSectionRow>
      )}

      {hostileGames.length > 0 && (
        <>
          <PanelSectionRow>
            <div style={{ padding: "10px 0" }}>
              <strong>{t(lang, "wishlist_found", { c: hostileGames.length })}:</strong>
              <ul style={{ paddingLeft: "20px", marginTop: "10px" }}>
                {hostileGames.map(g => (
                  <li key={g.appid}>
                    {(g as any).name || `App ${g.appid}`}
                  </li>
                ))}
              </ul>
            </div>
          </PanelSectionRow>
          <PanelSectionRow>
            <ButtonItem
              layout="below"
              onClick={removeHostileGames}
              disabled={isDeleting}
            >
              {isDeleting ? t(lang, "wishlist_removing") : t(lang, "wishlist_remove")}
            </ButtonItem>
          </PanelSectionRow>
        </>
      )}
    </PanelSection>
  );
};
