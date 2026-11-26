import { render, screen } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { I18nProvider } from "../../i18n/ui/I18nProvider";
import type { BlockedSender } from "../domain/blockedSender";
import { BlockedScreen } from "./BlockedScreen";

const renderWith = (items: BlockedSender[]) =>
  render(
    <I18nProvider store={{ get: () => null, set: vi.fn() }} browserLanguages={["en-US"]}>
      <BlockedScreen
        liveBlocked={{ items, failed: false, failure: null }}
        errors={[]}
        onUnblock={vi.fn()}
        onBack={vi.fn()}
      />
    </I18nProvider>,
  );

it("names each unblock button with the sender's name, bidi controls stripped (L69)", () => {
  renderWith([{ uid: "ana", name: "Ana\u2069\u202e", email: "ana@example.com" }]);
  expect(screen.getByRole("button", { name: "Unblock \u2068Ana\u2069" })).toBeInTheDocument();
});

it("names a sender with a blank name by their email (L69)", () => {
  renderWith([{ uid: "blank", name: "", email: "blank@example.com" }]);
  expect(
    screen.getByRole("button", { name: "Unblock \u2068blank@example.com\u2069" }),
  ).toBeInTheDocument();
});
