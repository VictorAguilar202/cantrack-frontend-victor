import { useState } from "react";

type PhotoInitialProps = {
  /** The screen's own avatar class, so size and colours stay as they are. */
  className: string;
  name: string;
  src?: string | null;
};

/** A screen's round initial badge that shows the person's photo when they
 *  have one, and falls back to the initial if it is missing or fails. */
export function PhotoInitial({ className, name, src }: PhotoInitialProps) {
  const [broken, setBroken] = useState(false);
  const showPhoto = typeof src === "string" && src !== "" && !broken;

  return (
    <span className={className} aria-hidden="true" data-photo={showPhoto ? "" : undefined}>
      {showPhoto ? (
        <img className="photo-initial__img" src={src} alt="" onError={() => setBroken(true)} />
      ) : (
        (name.trim().charAt(0) || "?").toUpperCase()
      )}
    </span>
  );
}
