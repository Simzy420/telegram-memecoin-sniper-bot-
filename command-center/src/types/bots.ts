export type AvatarShape = 'sphere' | 'pyramid' | 'cube';
export type AvatarHue = 'cyan' | 'purple' | 'violet' | 'gold' | 'green' | 'magenta';

export interface Bot {
  id: string;
  name: string;
  role: string;
  shape: AvatarShape;
  hue: AvatarHue;
}
