import { formatTime } from '../engine/util';

/** Score in 1/100 s as m:ss.cc */
export const fmt = (raw: number) => formatTime(raw / 100);
