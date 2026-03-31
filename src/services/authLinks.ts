import * as Linking from 'expo-linking';

export const PASSWORD_RESET_REDIRECT_URL = Linking.createURL('/reset-password');

export type AuthLinkSessionPayload = {
  accessToken: string;
  refreshToken: string;
  type: string | null;
};

export function extractAuthLinkSession(url: string): AuthLinkSessionPayload | null {
  if (!url) return null;

  const queryStart = url.indexOf('?');
  const hashStart = url.indexOf('#');

  const query = queryStart >= 0
    ? url.slice(queryStart + 1, hashStart >= 0 ? hashStart : undefined)
    : '';
  const hash = hashStart >= 0 ? url.slice(hashStart + 1) : '';
  const params = new URLSearchParams([query, hash].filter(Boolean).join('&'));

  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');

  if (!accessToken || !refreshToken) {
    return null;
  }

  return {
    accessToken,
    refreshToken,
    type: params.get('type'),
  };
}
