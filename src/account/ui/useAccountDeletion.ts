import { useEffect, useState } from "react";
import { AuthFailure, type AuthFailureKind } from "../../auth/domain/user";

interface AccountDeletionOptions {
  onDelete: () => Promise<void>;
  /** True when this page came back from Google re-confirming a deletion the user accepted. */
  confirmedByRedirect: () => Promise<boolean>;
  /** Called when a deletion resumes by itself after a redirect, before it runs. */
  onResume?: () => void;
}

export interface AccountDeletion {
  deleting: boolean;
  failure: AuthFailureKind | null;
  start: () => void;
}

const keepIfDataErased = (current: AuthFailureKind | null) =>
  current === "dataErased" ? current : null;

/**
 * The state of deleting the account. It belongs to the whole signed-in app, not to one screen,
 * so a deletion and its failure survive the user moving to another screen meanwhile.
 */
export function useAccountDeletion({
  onDelete,
  confirmedByRedirect,
  onResume,
}: AccountDeletionOptions): AccountDeletion {
  const [deleting, setDeleting] = useState(false);
  const [failure, setFailure] = useState<AuthFailureKind | null>(null);

  const start = () => {
    setDeleting(true);
    setFailure(keepIfDataErased);
    onDelete()
      .catch((error: unknown) => {
        const kind = error instanceof AuthFailure ? error.kind : "unknown";
        if (kind === "unknown") console.error("Deleting the account failed:", error);
        if (kind === "cancelled") return;
        // A wrong account changes nothing about what already happened, and that message covers it.
        setFailure((current) =>
          current === "dataErased" && kind === "wrongAccount" ? current : kind,
        );
      })
      .finally(() => {
        setDeleting(false);
      });
  };

  // Once per page load. Not cancelled on cleanup: the answer is handed out only once.
  useEffect(() => {
    confirmedByRedirect()
      .then((confirmed) => {
        if (!confirmed) return;
        onResume?.();
        start();
      })
      .catch((error: unknown) => {
        console.error("Checking for a pending deletion failed:", error);
      });
  }, []);

  // A redirect confirmation never settles, so returning with the back button would restore a stuck page.
  useEffect(() => {
    const handlePageShow = (event: PageTransitionEvent) => {
      if (event.persisted) setDeleting(false);
    };
    window.addEventListener("pageshow", handlePageShow);
    return () => {
      window.removeEventListener("pageshow", handlePageShow);
    };
  }, []);

  return { deleting, failure, start };
}
