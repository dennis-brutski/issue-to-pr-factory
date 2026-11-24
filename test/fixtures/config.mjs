// The shared defaults with an owner, as a local.mjs would set it. config.mjs has none.
import { config as defaults } from '../../config.mjs';

export const config = { ...defaults, owner: 'dennis-brutski', ownerName: 'Dennis' };
