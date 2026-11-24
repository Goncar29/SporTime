import type { SubscribeToList } from "../../shared/application/liveList";
import type { Contact } from "../domain/contact";

export interface AddedContact {
  contact: Contact;
  /** Settles when the server answers, which never happens offline, so callers must not wait for it. */
  saved: Promise<void>;
}

/**
 * The signed-in user's contacts, by name. Writes apply on this device right away and sync when
 * online; finding someone to add needs the server.
 */
export interface ContactStore {
  subscribe: SubscribeToList<Contact>;
  /**
   * Looks the email up in the directory and keeps whoever chose to be found by it. Resolves once
   * the contact is stored on this device; rejects with `ContactRefused` when they cannot be added.
   */
  add(email: string): Promise<AddedContact>;
  /** Settles when the server answers, which never happens offline, so callers must not wait for it. */
  remove(uid: string): Promise<void>;
}
