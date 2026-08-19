# Credits

## Art

**Terrain tiles** (`src/assets/terrain/sscap-terrain.png`) — cropped from the
[Community-Made SRPG Tileset (32×32) v1.3](https://markyjoe1990.itch.io/community-made-srpg-tileset-32x32),
by the SRPG Studio Community Asset Project (SSCAP) Discord server — artists
Briver, Soviet, General Ciraxis, Kennedy, and Yeedley/CardCafe (concept art),
licensed under [CC-BY 3.0](http://creativecommons.org/licenses/by/3.0/). Only
the plain grass, forest, stone-wall, and water tiles were extracted from the
`Outdoor.png` sheet in the pack; no changes were made to the sprites
themselves.

**Unit sprites** (`src/assets/units/`) — original artwork drawn for this
project by a friend of the developer. No external license applies. Covers all
seven classes: Swordsman, Archer, Lancer, Mage, Barbarian, Cleric, and Dancer.

## Audio

**Sound effects** (`src/assets/audio/`) — by Kenney Vleugels
([kenney.nl](https://kenney.nl)), all licensed under
[CC0 1.0](http://creativecommons.org/publicdomain/zero/1.0/). Files are
renamed by gameplay role; the source pack and original filename for each:

| Role | Pack | Original file |
| --- | --- | --- |
| `hit` | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactMetal_medium_000` |
| `crit` | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactPunch_heavy_000` |
| `defeat` | [Impact Sounds](https://kenney.nl/assets/impact-sounds) | `impactSoft_heavy_000` |
| `heal` | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `glass_004` |
| `confirm` | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `confirmation_001` |
| `cancel` | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `back_002` |
| `turn` | [Interface Sounds](https://kenney.nl/assets/interface-sounds) | `toggle_001` |
| `click` | [UI Audio](https://kenney.nl/assets/ui-audio) | `click1` |
| `drop` | [RPG Audio](https://kenney.nl/assets/rpg-audio) | `handleCoins2` |
| `level-up` | [Music Jingles](https://kenney.nl/assets/music-jingles) | `jingles_PIZZI00` |
| `wave-clear` | [Music Jingles](https://kenney.nl/assets/music-jingles) | `jingles_PIZZI01` |

The audio files themselves are unmodified. Per-cue level trim is applied at
runtime in `src/ui/sound.ts` (`SFX_GAIN`) rather than by re-encoding, since
the packs are mastered at very different levels.
