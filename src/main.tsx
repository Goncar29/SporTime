import "@fontsource/barlow-condensed/latin-600.css";
import "@fontsource/barlow-condensed/latin-800.css";
import "@fontsource/barlow-condensed/latin-800-italic.css";
import "./app/global.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./app/App";
import {
  createWakeLockScreenAwake,
  createWebAudioCuePlayer,
  systemClock,
} from "./timer/infrastructure/browserTimerAdapters";

const root = document.getElementById("root");
if (!root) throw new Error("Root element not found");

const timer = {
  clock: systemClock,
  cues: createWebAudioCuePlayer(),
  screenAwake: createWakeLockScreenAwake(),
};

createRoot(root).render(
  <StrictMode>
    <App timer={timer} />
  </StrictMode>,
);
