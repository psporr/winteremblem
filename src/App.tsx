import { useCallback, useMemo, useState } from 'react';
import { Client } from 'boardgame.io/react';

import { PLAYER_START_LEVEL } from './game/classes';
import { createWinterEmblem } from './game/game';
import { CAMPAIGN_CHAPTERS, CHAPTER_1, type CampaignCarryOver } from './game/maps';
import { loadCampaignSave, saveCampaign, type CampaignSave } from './game/save';
import type { GameMode } from './game/types';
import { Board } from './ui/Board';
import { CampaignMenu, ChapterSelect, TitleScreen } from './ui/TitleScreen';
import { MenuActionsContext, type MenuActions } from './ui/menuContext';

type Screen =
  | { kind: 'title' }
  | { kind: 'campaign-menu' }
  | { kind: 'chapter-select' }
  /** `runId` changes on retry, remounting the client for a fresh battle. */
  | { kind: 'game'; mode: GameMode; chapterId: string; runId: number };

/**
 * No multiplayer transport yet: the client owns both sides locally and the
 * board drives the CPU army itself. Swapping in a transport later is the only
 * change needed to put the same rules online.
 */
export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'title' });
  /**
   * What the squad carries from one campaign chapter into the next — set
   * only by continueCampaign, applied to the very next Client built. Kept
   * outside Screen so retrying the chapter it was carried into (bumping
   * runId) still rebuilds with the same carried-over stats rather than
   * resetting to that chapter's authored defaults. Cleared whenever a
   * chapter is entered any other way, so it can never leak into a chapter
   * the player picked directly.
   */
  const [campaignProgress, setCampaignProgress] = useState<CampaignCarryOver | null>(null);
  /**
   * The on-disk (localStorage) save — separate from campaignProgress, which
   * only lives for the current session. Read once at startup; updated
   * every time continueCampaign writes a new one, so "Continue" on the
   * title screen always reflects the latest chapter cleared without a
   * reload. There's no manual save step: a save is written automatically
   * at the one point that matters for a between-chapter save, continuing
   * to the next chapter, since nothing else changes progress worth saving.
   */
  const [savedGame, setSavedGame] = useState<CampaignSave | null>(() => loadCampaignSave());

  const exitToMenu = useCallback(() => {
    setCampaignProgress(null);
    setScreen({ kind: 'title' });
  }, []);

  const menuActions = useMemo<MenuActions>(
    () => ({
      exitToMenu,
      // Bumping runId changes the client's React key, remounting it with a
      // fresh setup rather than trying to reset a live boardgame.io client.
      retry: () => setScreen((current) => (current.kind === 'game' ? { ...current, runId: current.runId + 1 } : current)),
      continueCampaign: (nextChapterId, progress) => {
        setCampaignProgress(progress);
        const save: CampaignSave = { chapterId: nextChapterId, carryOver: progress, savedAt: new Date().toISOString() };
        saveCampaign(save);
        setSavedGame(save);
        setScreen((current) => ({
          kind: 'game',
          mode: 'campaign',
          chapterId: nextChapterId,
          runId: current.kind === 'game' ? current.runId + 1 : 0,
        }));
      },
    }),
    [exitToMenu],
  );

  // Rebuilt only when the battle itself changes — a Client is stateful, so
  // recreating it mid-battle would silently restart the chapter.
  const GameClient = useMemo(() => {
    if (screen.kind !== 'game') return null;
    const chapterIndex = CAMPAIGN_CHAPTERS.findIndex((candidate) => candidate.id === screen.chapterId);
    const chapter = screen.mode === 'campaign' ? (CAMPAIGN_CHAPTERS[chapterIndex] ?? CAMPAIGN_CHAPTERS[0]) : CHAPTER_1;
    // A player unit with no carry-over entry starts at this level. Chapter 1
    // (index 0) is just PLAYER_START_LEVEL, same as always; jumping straight
    // into a later chapter through Chapter Select scales it up so the squad
    // isn't stuck at a flat starting level against a chapter built for a
    // squad that fought its way there.
    const baseLevel = screen.mode === 'campaign' ? PLAYER_START_LEVEL + Math.max(0, chapterIndex) : undefined;

    return Client({
      game: createWinterEmblem(
        screen.mode,
        chapter,
        screen.mode === 'campaign' ? (campaignProgress ?? undefined) : undefined,
        baseLevel,
      ),
      board: Board,
      numPlayers: 2,
      debug: false,
    });
  }, [screen, campaignProgress]);

  if (screen.kind === 'title') {
    return (
      <TitleScreen
        onPlayRoguelike={() => setScreen({ kind: 'game', mode: 'roguelike', chapterId: CHAPTER_1.id, runId: 0 })}
        onOpenCampaign={() => setScreen({ kind: 'campaign-menu' })}
      />
    );
  }

  if (screen.kind === 'campaign-menu') {
    return (
      <CampaignMenu
        savedGame={savedGame}
        onNewGame={() => {
          // Always Chapter 1, never a stale carry-over from an earlier attempt.
          setCampaignProgress(null);
          setScreen({ kind: 'game', mode: 'campaign', chapterId: CAMPAIGN_CHAPTERS[0].id, runId: 0 });
        }}
        onContinueSaved={() => {
          if (!savedGame) return;
          setCampaignProgress(savedGame.carryOver);
          setScreen({ kind: 'game', mode: 'campaign', chapterId: savedGame.chapterId, runId: 0 });
        }}
        onChapterSelect={() => setScreen({ kind: 'chapter-select' })}
        onBack={exitToMenu}
      />
    );
  }

  if (screen.kind === 'chapter-select') {
    return (
      <ChapterSelect
        // Phase 2 replaces this with real saved progress; for now every
        // chapter is directly playable (see baseLevel above for how a
        // direct jump stays balanced without unlock gating).
        unlockedCount={CAMPAIGN_CHAPTERS.length}
        onPlayChapter={(chapterId) => {
          // A chapter picked directly off this screen always starts at its
          // own authored defaults, never a stale carry-over from an earlier
          // chapter the player abandoned mid-campaign.
          setCampaignProgress(null);
          setScreen({ kind: 'game', mode: 'campaign', chapterId, runId: 0 });
        }}
        onBack={() => setScreen({ kind: 'campaign-menu' })}
      />
    );
  }

  if (!GameClient) return null;

  return (
    <MenuActionsContext.Provider value={menuActions}>
      <GameClient key={`${screen.mode}-${screen.chapterId}-${screen.runId}`} />
    </MenuActionsContext.Provider>
  );
}
