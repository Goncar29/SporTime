import type { ReactNode } from "react";
import { useI18n } from "../i18n/ui/I18nProvider";
import styles from "./TabBar.module.css";

export type Tab = "timer" | "saved" | "history" | "profile";

interface TabBarProps {
  current: Tab;
  onSelect: (tab: Tab) => void;
}

/** Stroke icons drawn on a 24-unit grid, in the current text color. */
const ICONS: Record<Tab, ReactNode> = {
  timer: (
    <>
      <circle cx="12" cy="13.5" r="7.5" />
      <path d="M12 9.5v4l2.5 2.5M9.5 2.5h5M19 6l1.5-1.5" />
    </>
  ),
  saved: <path d="M6.5 3.5h11v17L12 16.5l-5.5 4z" />,
  history: (
    <>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3.5 3.5v4h4M12 8v4.5l3 2" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8.5" r="4" />
      <path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </>
  ),
};

/** The app's sections outside a running workout; the timer screen takes the whole display. */
export function TabBar({ current, onSelect }: TabBarProps) {
  const { t } = useI18n();
  const labels: Record<Tab, string> = {
    timer: t.tabTimer,
    saved: t.tabSaved,
    history: t.history,
    profile: t.profile,
  };

  return (
    <nav className={styles.bar} aria-label={t.sections}>
      {(Object.keys(labels) as Tab[]).map((tab) => (
        <button
          key={tab}
          className={styles.tab}
          aria-current={tab === current ? "page" : undefined}
          onClick={() => {
            onSelect(tab);
          }}
        >
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
            {ICONS[tab]}
          </svg>
          <span className={styles.label}>{labels[tab]}</span>
        </button>
      ))}
    </nav>
  );
}
