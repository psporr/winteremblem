import { PLAYER_START_LEVEL } from '../game/classes';
import { CAMPAIGN_CHAPTERS } from '../game/maps';
import type { CampaignSave } from '../game/save';
import pkg from '../../package.json';
import { MuteToggle } from './MuteToggle';
import { sound } from './sound';
import './titleScreen.css';

const GAME_VERSION = pkg.version;

/**
 * The game's front door: pick a mode. Campaign drills into its own small
 * menu (New Game / Continue / Chapter Select) rather than jumping straight
 * to a chapter list — see CampaignMenu. Language selection lands here too
 * once localization ships.
 */
export function TitleScreen({
  onPlayRoguelike,
  onOpenCampaign,
}: {
  onPlayRoguelike: () => void;
  onOpenCampaign: () => void;
}) {
  return (
    <div className="we-title we-title--top">
      <MuteToggle className="we-iconbutton we-iconbutton--icon we-title__mute" />
      <div className="we-title__inner">
        <h1 className="we-title__name we-title__name--brand">
          BIBI&rsquo;s <span>WinterEmblem</span>
        </h1>
        <p className="we-title__tagline">A turn-based tactics RPG</p>

        <div className="we-title__modes">
          <button
            type="button"
            className="we-mode-card"
            onClick={() => {
              sound.play('confirm');
              onOpenCampaign();
            }}
          >
            <span className="we-mode-card__name">Campaign</span>
            <span className="we-mode-card__blurb">
              Hand-crafted chapters, each with its own objective. Your squad carries its levels and gear
              forward.
            </span>
            <span className="we-mode-card__meta">
              {CAMPAIGN_CHAPTERS.length} chapter{CAMPAIGN_CHAPTERS.length === 1 ? '' : 's'} available
            </span>
          </button>

          <button
            type="button"
            className="we-mode-card we-mode-card--roguelike"
            onClick={() => {
              sound.play('confirm');
              onPlayRoguelike();
            }}
          >
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
 * The campaign's own front door: New Game always starts Chapter 1 fresh;
 * Continue resumes the saved chapter with its carried level/exp/equipment;
 * Chapter Select jumps straight to any chapter (see ChapterSelect below —
 * the caller scales the squad's starting level to that chapter automatically
 * so a direct jump doesn't leave it under-levelled).
 */
export function CampaignMenu({
  savedGame,
  onNewGame,
  onContinueSaved,
  onChapterSelect,
  onBack,
}: {
  savedGame: CampaignSave | null;
  onNewGame: () => void;
  onContinueSaved: () => void;
  onChapterSelect: () => void;
  onBack: () => void;
}) {
  const savedChapter = savedGame && CAMPAIGN_CHAPTERS.find((chapter) => chapter.id === savedGame.chapterId);

  return (
    <div className="we-title">
      <div className="we-title__inner">
        <h1 className="we-title__name we-title__name--small">Campaign</h1>

        <div className="we-chapter-list">
          <button
            type="button"
            className="we-chapter"
            onClick={() => {
              sound.play('confirm');
              onNewGame();
            }}
          >
            <span className="we-chapter__name">New Game</span>
            <span className="we-chapter__objective">Start the campaign from Chapter 1</span>
          </button>

          <button
            type="button"
            className={`we-chapter${savedChapter ? ' we-chapter--continue' : ' we-chapter--locked'}`}
            disabled={!savedChapter}
            onClick={() => {
              sound.play('confirm');
              onContinueSaved();
            }}
          >
            <span className="we-chapter__name">Continue</span>
            <span className="we-chapter__objective">
              {savedChapter ? `Resume at ${savedChapter.name}, with your carried levels and gear` : 'No saved game yet'}
            </span>
          </button>

          <button
            type="button"
            className="we-chapter"
            onClick={() => {
              sound.play('confirm');
              onChapterSelect();
            }}
          >
            <span className="we-chapter__name">Chapter Select</span>
            <span className="we-chapter__objective">Jump straight to any chapter</span>
          </button>
        </div>

        <button
          type="button"
          className="we-title__back"
          onClick={() => {
            sound.play('cancel');
            onBack();
          }}
        >
          Back
        </button>
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
        <h1 className="we-title__name we-title__name--small">Chapter Select</h1>

        <div className="we-chapter-list">
          {CAMPAIGN_CHAPTERS.map((chapter, index) => {
            const locked = index >= unlockedCount;
            return (
              <button
                key={chapter.id}
                type="button"
                className={`we-chapter${locked ? ' we-chapter--locked' : ''}`}
                disabled={locked}
                onClick={() => {
                  sound.play('confirm');
                  onPlayChapter(chapter.id);
                }}
              >
                <span className="we-chapter__name">{chapter.name}</span>
                <span className="we-chapter__objective">
                  {locked
                    ? 'Locked — clear the previous chapter first'
                    : `${chapter.objective} · squad starts at Lv. ${PLAYER_START_LEVEL + index}`}
                </span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          className="we-title__back"
          onClick={() => {
            sound.play('cancel');
            onBack();
          }}
        >
          Back
        </button>
      </div>
    </div>
  );
}
