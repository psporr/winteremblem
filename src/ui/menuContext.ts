import { createContext, useContext } from 'react';

export interface MenuActions {
  /** Abandon the current battle and return to the title screen. */
  exitToMenu: () => void;
  /** Restart the current battle from the top, same mode and chapter. */
  retry: () => void;
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
});

export function useMenuActions(): MenuActions {
  return useContext(MenuActionsContext);
}
