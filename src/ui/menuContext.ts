import { createContext, useContext } from 'react';

import type { CampaignCarryOver } from '../game/maps';

export interface MenuActions {
  /** Abandon the current battle and return to the title screen. */
  exitToMenu: () => void;
  /** Restart the current battle from the top, same mode and chapter. */
  retry: () => void;
  /** Load the next campaign chapter, carrying the squad's level/exp/equipment/inventory into it. */
  continueCampaign: (nextChapterId: string, progress: CampaignCarryOver) => void;
}

/**
 * Lets the board hand control back to App without threading props through
 * boardgame.io's Client, which owns the board's props — passing them that
 * way would rebuild the whole client (and restart the battle) whenever a
 * callback identity changed.
 */
export const MenuActionsContext = createContext<MenuActions>({
  exitToMenu: () => {},
  retry: () => {},
  continueCampaign: () => {},
});

export function useMenuActions(): MenuActions {
  return useContext(MenuActionsContext);
}
