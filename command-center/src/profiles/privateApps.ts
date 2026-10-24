/** Password-gated apps. Instances and saved credentials stay on the signed-in profile. */
export const PRIVATE_APP_TYPES = ['drive', 'gmail'] as const;

export function isPrivateApp(type: string): boolean {
  return (PRIVATE_APP_TYPES as readonly string[]).includes(type);
}
