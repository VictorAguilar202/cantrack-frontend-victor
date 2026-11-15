import { useEffect, useState } from "react";
import { formatCop } from "../lib/format.js";
import { fetchPublicWalker, type DogSize, type PublicWalker } from "../lib/marketplace.js";
import { experienceLabel, sizesLabel } from "../lib/walkerCard.js";
import { DogLoader } from "../ui/DogLoader.js";
import { PhotoInitial } from "../ui/PhotoInitial.js";
import "./walker-public.css";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const LONG_MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function shortDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
}

function since(iso: string | null): string | null {
  if (iso === null) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : `En CanTrack desde ${LONG_MONTHS[date.getMonth()]} de ${date.getFullYear()}`;
}

function stars(rating: number): string {
  const whole = Math.min(5, Math.max(0, Math.round(rating)));
  return "★".repeat(whole) + "☆".repeat(5 - whole);
}

export type WalkerPublicProfileProps = {
  walkerId: string;
  /** Shown while the profile loads, so the header doesn't jump. */
  fallbackName?: string;
  onBack: () => void;
  /** False when shown in an overlay, so the page underneath keeps its place. */
  scrollToTop?: boolean;
};

/** A walker's profile as owners see it: photo, numbers, bio and reviews, Instagram style. */
export function WalkerPublicProfile({ walkerId, fallbackName, onBack, scrollToTop = true }: WalkerPublicProfileProps) {
  const [walker, setWalker] = useState<PublicWalker | null>(null);
  const [error, setError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [zoom, setZoom] = useState(false);

  // Escape closes the enlarged photo, like tapping anywhere does.
  useEffect(() => {
    if (!zoom) return;
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && setZoom(false);
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [zoom]);

  useEffect(() => {
    let active = true;
    setError(false);
    fetchPublicWalker(walkerId)
      .then((loaded) => active && setWalker(loaded))
      .catch(() => active && setError(true));
    return () => {
      active = false;
    };
  }, [walkerId, attempt]);

  useEffect(() => {
    if (scrollToTop) {
      document.querySelector(".phone-frame__scroll")?.scrollTo?.({ top: 0 });
    }
  }, [scrollToTop]);

  const back = (
    <button type="button" className="explore__small owalks__back" onClick={onBack}>
      ← Volver
    </button>
  );

  if (walker === null) {
    return (
      <div className="explore oglass wpub">
        {back}
        {error ? (
          <div className="glass oglass__retry">
            <p className="explore__error" role="alert">No pudimos cargar el perfil del paseador.</p>
            <button type="button" className="explore__small explore__small--lime" onClick={() => setAttempt((n) => n + 1)}>
              Reintentar
            </button>
          </div>
        ) : (
          <DogLoader label={`Cargando el perfil de ${fallbackName ?? "tu paseador"}…`} pose="walk" />
        )}
      </div>
    );
  }

  const name = walker.displayName ?? fallbackName ?? "Paseador";
  const rating = walker.stats.rating;
  const chips = [
    walker.serviceArea ? `📍 ${walker.serviceArea}` : null,
    experienceLabel(walker.experienceYears),
    sizesLabel(walker.dogSizes as DogSize[]),
    walker.pricePerWalk !== null ? `Desde ${formatCop(walker.pricePerWalk)}` : null,
  ].filter((chip): chip is string => chip !== null);
  const most = Math.max(1, ...rating.breakdown);
  const joined = since(walker.memberSince);

  return (
    <div className="explore oglass wpub">
      {back}

      <section className="glass wpub__card" aria-label={`Perfil de ${name}`}>
        <div className="wpub__top">
          {walker.avatarUrl ? (
            <button
              type="button"
              className="wpub__ring wpub__ring--button"
              onClick={() => setZoom(true)}
              aria-label={`Ver la foto de ${name}`}
            >
              <PhotoInitial className="wpub__avatar" name={name} src={walker.avatarUrl} />
            </button>
          ) : (
            <span className="wpub__ring">
              <PhotoInitial className="wpub__avatar" name={name} src={walker.avatarUrl} />
            </span>
          )}
          <dl className="wpub__stats">
            <div><dd>{walker.stats.walksDone}</dd><dt>Paseos</dt></div>
            <div><dd>{walker.stats.hoursWalked}</dd><dt>Horas</dt></div>
            <div><dd>{walker.stats.clients}</dd><dt>Clientes</dt></div>
          </dl>
        </div>

        <h1 className="wpub__name">{name}</h1>
        <p className="wpub__rating">
          {rating.average !== null && rating.count > 0
            ? `★ ${rating.average.toFixed(1)} · ${rating.count} ${rating.count === 1 ? "calificación" : "calificaciones"}`
            : "Paseador nuevo en CanTrack"}
        </p>
        {walker.bio ? <p className="wpub__bio">{walker.bio}</p> : null}
        {chips.length > 0 ? (
          <ul className="wpub__chips">
            {chips.map((chip) => <li key={chip}>{chip}</li>)}
          </ul>
        ) : null}
        {joined !== null ? <p className="wpub__since">{joined}</p> : null}
      </section>

      {zoom && walker.avatarUrl ? (
        <div
          className="wpub-zoom"
          role="dialog"
          aria-modal="true"
          aria-label={`Foto de ${name}`}
          onClick={() => setZoom(false)}
        >
          <img className="wpub-zoom__photo" src={walker.avatarUrl} alt={`Foto de ${name}`} />
          <button type="button" className="wpub-zoom__close" onClick={() => setZoom(false)} autoFocus>
            Cerrar
          </button>
        </div>
      ) : null}

      <section className="glass wpub__card" aria-label="Reseñas">
        <h2 className="wpub__section">Reseñas</h2>
        {rating.count > 0 ? (
          <ol className="wpub__bars" aria-label="Calificaciones por estrellas">
            {[5, 4, 3, 2, 1].map((star) => {
              const count = rating.breakdown[star - 1] ?? 0;
              return (
                <li key={star}>
                  <span>{star}★</span>
                  <span className="wpub__bar"><span style={{ width: `${(count / most) * 100}%` }} /></span>
                  <span>{count}</span>
                </li>
              );
            })}
          </ol>
        ) : null}
        {walker.reviews.length === 0 ? (
          <p className="wpub__empty">Todavía no tiene reseñas. ¡Puedes ser el primero!</p>
        ) : (
          <ul className="wpub__reviews">
            {walker.reviews.map((review, index) => (
              <li key={`${review.at}-${index}`}>
                <span className="wpub__stars" aria-label={`${review.rating} de 5 estrellas`}>{stars(review.rating)}</span>
                <span className="wpub__review-meta">
                  {review.dogName ? `Paseo con ${review.dogName}` : "Paseo"} · {shortDate(review.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
