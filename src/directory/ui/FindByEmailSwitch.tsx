import { useEffect, useId, useState } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { reportStoreFailure } from "../../shared/ui/storeFailure";
import type { DirectoryListing } from "../application/ports";
import styles from "./FindByEmailSwitch.module.css";

interface FindByEmailSwitchProps {
  listing: DirectoryListing;
}

/**
 * Off by default: it shows whether this account's entry exists under its email, so it follows
 * a change made on another device, and a refused change shows as the entry staying as it was.
 */
export function FindByEmailSwitch({ listing }: FindByEmailSwitchProps) {
  const { t } = useI18n();
  const hintId = useId();
  /** Null until the directory answers. */
  const [listed, setListed] = useState<boolean | null>(null);
  const [failure, setFailure] = useState<"change" | "load" | null>(null);

  useEffect(
    () =>
      listing.subscribe(
        (now) => {
          setListed(now);
          setFailure((current) => (current === "load" ? null : current));
        },
        (error: unknown) => {
          reportStoreFailure("Reading the directory entry", error);
          setFailure("load");
        },
      ),
    [listing],
  );

  const change = (on: boolean) => {
    setFailure(null);
    // Not awaited: the server never answers offline, and the change already shows from this device.
    (on ? listing.list() : listing.unlist()).catch((error: unknown) => {
      reportStoreFailure(on ? "Listing in the directory" : "Leaving the directory", error);
      setFailure("change");
    });
  };

  return (
    <div className={styles.block}>
      <label className={styles.row}>
        <span className={styles.label}>{t.findByEmail}</span>
        <input
          className={styles.switch}
          type="checkbox"
          role="switch"
          checked={listed === true}
          disabled={listed === null}
          aria-describedby={hintId}
          onChange={(event) => {
            change(event.target.checked);
          }}
        />
      </label>
      <p id={hintId} className={styles.hint}>
        {t.findByEmailHint}
      </p>
      {failure && (
        <p className={styles.error} role="alert">
          {failure === "change" ? t.findByEmailChangeFailed : t.findByEmailLoadFailed}
        </p>
      )}
    </div>
  );
}
