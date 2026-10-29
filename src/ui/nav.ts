/** Maps a key press to a menu action. WASD works like the arrows; Space and Enter both confirm. */
export type Nav = 'up' | 'down' | 'left' | 'right' | 'ok' | 'back' | null;
export function nav(e: KeyboardEvent): Nav {
  switch (e.key) {
    case 'ArrowUp':
    case 'w':
    case 'W':
      return 'up';
    case 'ArrowDown':
    case 's':
    case 'S':
      return 'down';
    case 'ArrowLeft':
    case 'a':
    case 'A':
      return 'left';
    case 'ArrowRight':
    case 'd':
    case 'D':
      return 'right';
    case 'Enter':
    case ' ':
      return 'ok';
    case 'Escape':
      return 'back';
    default:
      return null;
  }
}
