/** Surface ids stored per pixel in `World.surf`. */
export const GRASS = 0; // off-road ground of any kind (grass, sand, snow...)
export const ASPHALT = 1;
export const CURB = 2;
export const SOLID = 3; // scenery you bounce off
export const WATER = 4;

/** Thickness of a bridge's parapet on each side of the deck (a solid wall for cars on the bridge). */
export const PARAPET = 4;

/** Hazard ids stored per pixel in `World.hazard`. */
export const HAZ_NONE = 0;
export const HAZ_PUDDLE = 1;
export const HAZ_OIL = 2;
