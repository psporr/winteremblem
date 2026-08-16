import { CAMPAIGN_CHAPTERS } from '../game/maps';
import pkg from '../../package.json';
import './titleScreen.css';

const GAME_VERSION = pkg.version;

/**
 * The game's front door: pick a mode, or drill into the campaign's chapter
 * list. Language selection lands here too once localization ships.
 */
export function TitleScreen({
  onPlayRoguelike,
  onOpenCampaign,
}: {
  onPlayRoguelike: () => void;
  onOpenCampaign: () => void;
}) {
  return (
    <div className="we-title">
      <div className="we-title__inner">
        <h1 className="we-title__name we-title__name--brand">
          BIBI&rsquo;s <span>WinterEmblem</span>
        </h1>
        <p className="we-title__tagline">A turn-based tactics RPG</p>

        <div className="we-title__modes">
          <button type="button" className="we-mode-card" onClick={onOpenCampaign}>
            <span className="we-mode-card__name">Campaign</span>
            <span className="we-mode-card__blurb">
              Hand-crafted chapters, each with its own objective. Your squad carries its levels and gear
              forward.
            </span>
            <span className="we-mode-card__meta">
              {CAMPAIGN_CHAPTERS.length} chapter{CAMPAIGN_CHAPTERS.length === 1 ? '' : 's'} available
            </span>
          </button>

          <button type="button" className="we-mode-card we-mode-card--roguelike" onClick={onPlayRoguelike}>
            <span className="we-mode-card__name">Roguelike</span>
            <span className="we-mode-card__blurb">
              Endless waves on one map. Pick a blessing after every clear and see how far you get.
            </span>
            <span className="we-mode-card__meta">One life, no continues</span>
          </button>
        </div>

        <p className="we-title__version">v{GAME_VERSION}</p>
      </div>
    </div>
  );
}

/**
 * Campaign chapter list. Only the first chapter exists today, but the
 * locked/unlocked shape is here already so adding chapters in phase 2 is
 * purely additive — `unlockedCount` decides how far down the list is
 * playable.
 */
export function ChapterSelect({
  unlockedCount,
  onPlayChapter,
  onBack,
}: {
  unlockedCount: number;
  onPlayChapter: (chapterId: string) => void;
  onBack: () => void;
}) {
  return (
    <div className="we-title">
      <div className="we-title__inner">
        <h1 className="we-title__name we-title__name--small">Campaign</h1>

        <div className="we-chapter-list">
          {CAMPAIGN_CHAPTERS.map((chapter, index) => {
            const locked = index >= unlockedCount;
            return (
              <button
                key={chapter.id}
                type="button"
                className={`we-chapter${locked ? ' we-chapter--locked' : ''}`}
                disabled={locked}
                onClick={() => onPlayChapter(chapter.id)}
              >
                <span className="we-chapter__name">{chapter.name}</span>
                <span className="we-chapter__objective">
                  {locked ? 'Locked — clear the previous chapter first' : chapter.objective}
                </span>
              </button>
            );
          })}
        </div>

        <button type="button" className="we-title__back" onClick={onBack}>
          Back
        </button>
      </div>
    </div>
  );
}
