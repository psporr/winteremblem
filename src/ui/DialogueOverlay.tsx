import { useState, type CSSProperties } from 'react';

import type { DialogueScript } from '../game/story';
import { SPRITE_DISPLAY_HEIGHT, UNIT_SPRITES } from './unitSprites';

/**
 * Full-screen, one-line-at-a-time dialogue: chapter intros/outros and
 * mid-battle story beats all render through this. Advances on tap/click
 * anywhere on the card; the caller is only told once the whole script is
 * through, at which point it's safe to resume play.
 */
export function DialogueOverlay({ script, onComplete }: { script: DialogueScript; onComplete: () => void }) {
  const [index, setIndex] = useState(0);
  const line = script[index];
  const isLast = index === script.length - 1;

  function advance() {
    if (isLast) onComplete();
    else setIndex((current) => current + 1);
  }

  const sprite = line.portraitClass ? UNIT_SPRITES[line.portraitClass] : undefined;
  const side = line.side ?? 'left';

  return (
    <div className="we-overlay we-dialogue" role="dialog" aria-modal="true" onClick={advance}>
      <div className={`we-dialogue__card we-dialogue__card--${side}`}>
        {sprite && (
          <span
            className="we-unit__sprite we-dialogue__portrait"
            style={
              {
                '--frame-w': `${sprite.frameWidth}px`,
                '--frame-h': `${sprite.frameHeight}px`,
                '--frame-count': sprite.frames,
                '--sprite-src': `url(${sprite.src})`,
                // Larger than the on-board token — this is the whole point
                // of the shot, not a unit standing among many.
                '--sprite-scale': (SPRITE_DISPLAY_HEIGHT * 2.2) / sprite.frameHeight,
              } as CSSProperties
            }
          />
        )}
        <div className="we-dialogue__body">
          <p className="we-dialogue__speaker">{line.speaker}</p>
          <p className="we-dialogue__text">{line.text}</p>
        </div>
      </div>
      <p className="we-dialogue__hint">{isLast ? 'Tap to continue' : `Tap for next • ${index + 1}/${script.length}`}</p>
    </div>
  );
}
