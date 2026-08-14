import { Client } from 'boardgame.io/react';

import { WinterEmblem } from './game/game';
import { Board } from './ui/Board';

/**
 * No multiplayer transport yet: the client owns both sides locally and the
 * board drives the CPU army itself. Swapping in a transport later is the only
 * change needed to put the same rules online.
 */
const WinterEmblemClient = Client({
  game: WinterEmblem,
  board: Board,
  numPlayers: 2,
  debug: false,
});

export default function App() {
  return <WinterEmblemClient />;
}
