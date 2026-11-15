import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { CityPreview } from "./city/CityPreview.js";
import { HomeDashboard } from "./home/HomeDashboard.js";
import { GlobalDogLoader } from "./mascot/GlobalDogLoader.js";
import { DeviceChrome } from "./DeviceChrome.js";
import { PrivacyPage } from "./legal/PrivacyPage.js";
import "./phone-frame.css";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Unable to mount CanTrack: the root element is missing.");
}

const previewPage = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get("preview")
  : null;

function Root() {
  if (window.location.pathname === "/privacidad") {
    return <PrivacyPage />;
  }
  if (previewPage === "city") {
    return <CityPreview />;
  }
  if (previewPage === "home-owner") {
    return <HomeDashboard role="owner" />;
  }
  if (previewPage === "home-walker") {
    return <HomeDashboard role="walker" />;
  }
  return <App />;
}

// Installed on an iPhone (black-translucent status bar), the page is drawn from
// the very top of the screen but the viewport it reports is the screen minus
// the status bar, so the frame stopped ~62pt short and the body showed below.
// There the whole screen is the app, so size the frame to the screen itself.
const isInstalledIphone =
  /iPhone|iPod/.test(navigator.userAgent) &&
  ((navigator as Navigator & { standalone?: boolean }).standalone === true ||
    (typeof window.matchMedia === "function" && window.matchMedia("(display-mode: standalone)").matches));

function fitInstalledIphone(frame: HTMLElement) {
  // Always the full screen, from the top edge: some iOS versions report a short
  // viewport, others report the right height but still leave the bottom band,
  // so the reported viewport is never trusted here.
  const portrait = window.innerHeight >= window.innerWidth;
  const screenHeight = portrait ? Math.max(screen.height, screen.width) : Math.min(screen.height, screen.width);
  frame.style.top = "0px";
  frame.style.bottom = "auto";
  frame.style.height = `${Math.max(screenHeight, window.innerHeight)}px`;
}

const trackedFrames = new WeakSet<HTMLElement>();

/**
 * Screens size themselves with var(--app-h) instead of 100dvh (100dvh is
 * shorter than the screen on an installed iPhone): the frame's real height is
 * the truth, so publish it, and keep it current on resize and rotation.
 * A ref callback, because the frame only exists once React has rendered.
 */
function trackFrame(frame: HTMLDivElement | null) {
  if (frame === null || trackedFrames.has(frame)) {
    return;
  }
  trackedFrames.add(frame);
  const publishHeight = () => {
    if (isInstalledIphone) {
      fitInstalledIphone(frame);
    }
    frame.style.setProperty("--app-h", `${frame.clientHeight}px`);
  };
  publishHeight();
  if (typeof ResizeObserver !== "undefined") {
    new ResizeObserver(publishHeight).observe(frame);
  }
  window.addEventListener("resize", publishHeight);
}

createRoot(rootElement).render(
  <StrictMode>
    <div className="iphone">
      <span className="iphone__button iphone__button--action" />
      <span className="iphone__button iphone__button--up" />
      <span className="iphone__button iphone__button--down" />
      <span className="iphone__button iphone__button--power" />
      <div className="phone-frame" ref={trackFrame}>
        <div className="phone-frame__scroll">
          <Root />
        </div>
        {/* The one global mascot: saves, errors and the logout goodbye. */}
        <GlobalDogLoader />
        <DeviceChrome />
      </div>
    </div>
  </StrictMode>,
);
