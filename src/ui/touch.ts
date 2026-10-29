/** True on devices whose main pointer is a finger, where the on-screen driving buttons are shown. */
export const wantsTouchPad = () => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
