/**
 * Public Client ID of Tandem's GitHub OAuth App (research S5). A client id is not a secret.
 * Registered under sudo-studio-lab; override with env TANDEM_GITHUB_CLIENT_ID.
 */
export const GITHUB_OAUTH_CLIENT_ID = "Ov23liwi6szBzIMQhjKo";

export function getGitHubClientId(env: NodeJS.ProcessEnv = process.env): string {
  return env.TANDEM_GITHUB_CLIENT_ID?.trim() || GITHUB_OAUTH_CLIENT_ID;
}
