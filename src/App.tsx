import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { Client } from 'boardgame.io/react';

import { createWinterEmblem } from './game/game';
import { CAMPAIGN_CHAPTERS, CHAPTER_1 } from './game/maps';
import type { GameMode } from './game/types';
import { Board } from './ui/Board';
import { ChapterSelect, TitleScreen } from './ui/TitleScreen';
import { MenuActionsContext, type MenuActions } from './ui/menuContext';

/**
 * Phaser is ~1.4 MB — far bigger than the entire rest of the game — and the
 * prototype that uses it isn't part of normal play. Loading it lazily keeps
 * it out of the main bundle entirely: players who never open the demo never
 * download the engine.
 */
const PhaserPrototype = lazy(() =>
  import('./ui/PhaserPrototype').then((module) => ({ default: module.PhaserPrototype })),
);

type Screen =
  | { kind: 'title' }
  | { kind: 'chapter-select' }
  /** Throwaway render-layer experiment; not part of the game proper. */
  | { kind: 'phaser-demo' }
  /** `runId` changes on retry, remounting the client for a fresh battle. */
  | { kind: 'game'; mode: GameMode; chapterId: string; runId: number };

/**
 * No multiplayer transport yet: the client owns both sides locally and the
 * board drives the CPU army itself. Swapping in a transport later is the only
 * change needed to put the same rules online.
 */
export default function App() {
  const [screen, setScreen] = useState<Screen>({ kind: 'title' });

  const exitToMenu = useCallback(() => setScreen({ kind: 'title' }), []);

  const menuActions = useMemo<MenuActions>(
    () => ({
      exitToMenu,
      // Bumping runId changes the client's React key, remounting it with a
      // fresh setup rather than trying to reset a live boardgame.io client.
      retry: () => setScreen((current) => (current.kind === 'game' ? { ...current, runId: current.runId + 1 } : current)),
    }),
    [exitToMenu],
  );

  // Rebuilt only when the battle itself changes — a Client is stateful, so
  // recreating it mid-battle would silently restart the chapter.
  const GameClient = useMemo(() => {
    if (screen.kind !== 'game') return null;
    const chapter =
      screen.mode === 'campaign'
        ? (CAMPAIGN_CHAPTERS.find((candidate) => candidate.id === screen.chapterId) ?? CAMPAIGN_CHAPTERS[0])
        : CHAPTER_1;

    return Client({
      game: createWinterEmblem(screen.mode, chapter),
      board: Board,
      numPlayers: 2,
      debug: false,
    });
  }, [screen]);

  if (screen.kind === 'title') {
    return (
      <TitleScreen
        onPlayRoguelike={() => setScreen({ kind: 'game', mode: 'roguelike', chapterId: CHAPTER_1.id, runId: 0 })}
        onOpenCampaign={() => setScreen({ kind: 'chapter-select' })}
        onOpenPhaserDemo={() => setScreen({ kind: 'phaser-demo' })}
      />
    );
  }

  if (screen.kind === 'phaser-demo') {
    // The fallback is styled inline rather than via a class: the prototype's
    // stylesheet ships inside the lazy chunk, so it hasn't loaded yet here.
    return (
      <Suspense
        fallback={
          <div style={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', color: '#9fb3d1' }}>
            Loading Phaser…
          </div>
        }
      >
        <PhaserPrototype onBack={exitToMenu} />
      </Suspense>
    );
  }

  if (screen.kind === 'chapter-select') {
    return (
      <ChapterSelect
        // Phase 2 replaces this with real saved progress; for now the only
        // authored chapter is always playable.
        unlockedCount={CAMPAIGN_CHAPTERS.length}
        onPlayChapter={(chapterId) => setScreen({ kind: 'game', mode: 'campaign', chapterId, runId: 0 })}
        onBack={exitToMenu}
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
