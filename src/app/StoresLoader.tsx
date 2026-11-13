import { Component, Suspense, use, useState, type ReactNode } from "react";
import { useI18n } from "../i18n/ui/I18nProvider";
import styles from "./StoresLoader.module.css";

export interface StoresLoad<T> {
  /** The same promise on every call, so React can wait for it, until `retry`. */
  current: () => Promise<T>;
  /** Forgets the last load, so the next `current` fetches again. */
  retry: () => void;
}

/** A failed load, told apart from errors in the app it shows. */
class StoresLoadError extends Error {
  constructor(cause: unknown) {
    super("The account's stores did not load", { cause });
  }
}

/** Loads once and shares the result; a failure stays until the user asks to retry. */
export function createStoresLoad<T>(load: () => Promise<T>): StoresLoad<T> {
  let pending: Promise<T> | undefined;
  return {
    current: () =>
      (pending ??= load().catch((cause: unknown) => {
        throw new StoresLoadError(cause);
      })),
    retry: () => {
      pending = undefined;
    },
  };
}

interface StoresLoaderProps<T> {
  load: StoresLoad<T>;
  children: (loaded: T) => ReactNode;
}

/** Shows the signed-in app once its stores have loaded, and a retry if they could not. */
export function StoresLoader<T>({ load, children }: StoresLoaderProps<T>) {
  const [attempt, setAttempt] = useState(0);
  return (
    <LoadFailureBoundary
      key={attempt}
      onRetry={() => {
        load.retry();
        setAttempt((current) => current + 1);
      }}
    >
      <Suspense fallback={<main aria-busy="true" />}>
        <Loaded load={load}>{children}</Loaded>
      </Suspense>
    </LoadFailureBoundary>
  );
}

function Loaded<T>({ load, children }: StoresLoaderProps<T>) {
  return children(use(load.current()));
}

interface BoundaryProps {
  onRetry: () => void;
  children: ReactNode;
}

/** Catches only a failed load; an error in the loaded app goes on to whatever handles it above. */
class LoadFailureBoundary extends Component<BoundaryProps, { error: unknown }> {
  override state: { error: unknown } = { error: null };

  static getDerivedStateFromError(error: unknown) {
    return { error };
  }

  override componentDidCatch(error: unknown) {
    if (error instanceof StoresLoadError) {
      console.error("Loading the account's stores failed:", error.cause);
    }
  }

  override render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (error instanceof StoresLoadError) return <LoadFailure onRetry={this.props.onRetry} />;
    throw error;
  }
}

function LoadFailure({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  return (
    <main className={styles.page}>
      <p className={styles.error} role="alert">
        {t.accountLoadFailed}
      </p>
      <button className={styles.retry} onClick={onRetry}>
        {t.tryAgain}
      </button>
    </main>
  );
}
