import { useState } from 'react';
import { sound } from './sound';

/**
 * Shared mute button for the title screen and the in-battle header. Local
 * `muted` state mirrors the sound singleton rather than reading it directly
 * on every render, since the singleton itself isn't reactive.
 */
export function MuteToggle({ className = 'we-iconbutton we-iconbutton--icon' }: { className?: string }) {
  const [muted, setMuted] = useState(() => sound.isMuted());

  function toggle() {
    const next = !muted;
    sound.setMuted(next);
    setMuted(next);
  }

  return (
    <button
      type="button"
      className={className}
      aria-pressed={muted}
      aria-label={muted ? 'Unmute sound' : 'Mute sound'}
      title={muted ? 'Unmute sound' : 'Mute sound'}
      onClick={toggle}
    >
      {muted ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M16.5 12A4.5 4.5 0 0 0 14 8v1.9l2.48 2.48c.01-.13.02-.25.02-.38zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.9 8.9 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a8.99 8.99 0 0 0 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4 9.91 6.09 12 8.18V4z"
          />
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path
            fill="currentColor"
            d="M3 9v6h4l5 5V4L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
          />
        </svg>
      )}
    </button>
  );
}
