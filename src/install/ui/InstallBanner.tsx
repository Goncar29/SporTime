import { useState } from "react";
import { useI18n } from "../../i18n/ui/I18nProvider";
import styles from "./InstallBanner.module.css";
import { useInstall } from "./InstallProvider";

/** A small notice at the top of the first screen, until it is used or put off for 30 days. */
export function InstallBanner() {
  const { t } = useI18n();
  const { state, offered, install, dismiss } = useInstall();
  if (!offered) return null;

  return (
    <section className={styles.banner} aria-label={t.installTitle}>
      <svg
        className={styles.icon}
        viewBox="0 0 24 24"
        aria-hidden="true"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <rect x="6" y="2.5" width="12" height="19" rx="2.5" />
        <path d="M12 7v7.5M9 11.5l3 3 3-3M10.5 18.5h3" />
      </svg>
      <div className={styles.text}>
        <p className={styles.title}>{t.installOffer}</p>
        {state === "ios" && <p className={styles.steps}>{t.installIosSteps}</p>}
      </div>
      <div className={styles.actions}>
        {state === "prompt" && (
          <button
            className={styles.install}
            onClick={() => {
              void install();
            }}
          >
            {t.install}
          </button>
        )}
        <button className={styles.later} onClick={dismiss}>
          {t.notNow}
        </button>
      </div>
    </section>
  );
}

/** Kept on Profile even after "Not now", for whoever changes their mind. */
export function InstallOption({ className }: { className?: string }) {
  const { t } = useI18n();
  const { state, install } = useInstall();
  const [showingSteps, setShowingSteps] = useState(false);
  if (state !== "prompt" && state !== "ios") return null;

  return (
    <>
      <button
        className={className}
        aria-expanded={state === "ios" ? showingSteps : undefined}
        onClick={() => {
          if (state === "ios") setShowingSteps((showing) => !showing);
          else void install();
        }}
      >
        {t.installApp}
      </button>
      {state === "ios" && showingSteps && <p className={styles.optionSteps}>{t.installIosSteps}</p>}
    </>
  );
}
