import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { PrivacyScreen } from "../../account/ui/PrivacyScreen";
import { useI18n } from "../../i18n/ui/I18nProvider";
import { LanguageSwitcher } from "../../i18n/ui/LanguageSwitcher";
import type { AuthGateway } from "../application/ports";
import { AuthFailure, type AuthFailureKind, type User } from "../domain/user";
import styles from "./AuthGate.module.css";

interface Auth {
  user: User;
  signOut: () => void;
  /** For a failure that ends the session, whose own screen is gone by the time it arrives. */
  reportFailure: (kind: AuthFailureKind) => void;
}

const AuthContext = createContext<Auth | null>(null);

export function useAuth(): Auth {
  const auth = useContext(AuthContext);
  if (!auth) throw new Error("useAuth must be used inside AuthGate");
  return auth;
}

const failureKindOf = (error: unknown): AuthFailureKind =>
  error instanceof AuthFailure ? error.kind : "unknown";

interface AuthGateProps {
  gateway: AuthGateway;
  children: ReactNode;
}

export function AuthGate({ gateway, children }: AuthGateProps) {
  // `undefined` means the stored session has not been read yet.
  const [user, setUser] = useState<User | null | undefined>(undefined);
  const [signingIn, setSigningIn] = useState(false);
  const [failure, setFailure] = useState<AuthFailureKind | null>(null);

  const handleFailure = (error: unknown) => {
    const kind = failureKindOf(error);
    setFailure(kind === "cancelled" ? null : kind);
  };

  useEffect(
    () =>
      gateway.subscribe((next) => {
        setUser(next);
        if (next) setFailure(null);
      }),
    [gateway],
  );

  // A redirect sign-in never settles, so returning with the back button would restore a stuck page.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setSigningIn(false);
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  useEffect(() => {
    gateway.completePendingSignIn().catch(handleFailure);
  }, [gateway]);

  const auth = useMemo(
    () =>
      user
        ? {
            user,
            reportFailure: setFailure,
            signOut() {
              gateway.signOut().catch((error: unknown) => {
                console.error("Sign-out failed:", error);
              });
            },
          }
        : null,
    [user, gateway],
  );

  if (user === undefined) return <main className={styles.page} aria-busy="true" />;

  if (auth) return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;

  return (
    <SignInScreen
      signingIn={signingIn}
      failure={failure}
      onSignIn={() => {
        setSigningIn(true);
        setFailure(null);
        gateway
          .signIn()
          .catch(handleFailure)
          .finally(() => {
            setSigningIn(false);
          });
      }}
    />
  );
}

interface SignInScreenProps {
  signingIn: boolean;
  failure: AuthFailureKind | null;
  onSignIn: () => void;
}

function SignInScreen({ signingIn, failure, onSignIn }: SignInScreenProps) {
  const { t } = useI18n();
  const [showingPrivacy, setShowingPrivacy] = useState(false);

  if (showingPrivacy) {
    return (
      <PrivacyScreen
        onBack={() => {
          setShowingPrivacy(false);
        }}
      />
    );
  }

  return (
    <main className={styles.page}>
      <div className={styles.language}>
        <LanguageSwitcher />
      </div>
      <div className={styles.hero}>
        <h1 className={styles.brand}>Sportime</h1>
        <p className={styles.headline}>{t.signInHeadline}</p>
      </div>
      <div className={styles.actions}>
        {failure && (
          <p className={styles.error} role="alert">
            {failure === "sessionEnded"
              ? t.deleteAccountErrorSessionEnded
              : failure === "network"
                ? t.signInErrorNetwork
                : t.signInErrorUnknown}
          </p>
        )}
        <button className={styles.google} disabled={signingIn} onClick={onSignIn}>
          <GoogleLogo />
          {signingIn ? t.signingIn : t.continueWithGoogle}
        </button>
        <p className={styles.note}>{t.signInDataNote}</p>
        <button
          className={styles.privacy}
          onClick={() => {
            setShowingPrivacy(true);
          }}
        >
          {t.privacy}
        </button>
      </div>
    </main>
  );
}

function GoogleLogo() {
  return (
    <svg className={styles.logo} viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#EA4335"
        d="M24 9.5c3.5 0 6.7 1.2 9.2 3.6l6.9-6.9C35.9 2.4 30.5 0 24 0 14.6 0 6.5 5.4 2.6 13.2l8 6.2C12.4 13.7 17.7 9.5 24 9.5z"
      />
      <path
        fill="#4285F4"
        d="M46.9 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.9c-.6 3-2.2 5.5-4.7 7.2l7.7 6c4.5-4.2 7-10.3 7-17.7z"
      />
      <path
        fill="#FBBC05"
        d="M10.5 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-8-6.2C.9 16.5 0 20.1 0 24s.9 7.5 2.6 10.8l7.9-6.2z"
      />
      <path
        fill="#34A853"
        d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.7-6c-2.1 1.4-4.9 2.3-8.2 2.3-6.3 0-11.6-4.2-13.5-9.9l-8 6.2C6.5 42.6 14.6 48 24 48z"
      />
    </svg>
  );
}
