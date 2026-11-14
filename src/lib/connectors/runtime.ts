import { fetch as expoFetch } from 'expo/fetch';

import type { ToolExecutor } from '../llm/agent';
import { githubResource } from '../projects';
import type { Project } from '../projects';
import { deleteSecret, getSecret, setSecret } from '../secure';
import { useConnectors } from '@/store/connectors';

import { createGitHubClient } from './github';
import type { GitHubClient, GitHubFetch } from './github';
import { createGoogleClient } from './google';
import type { GoogleFetch } from './google';
import { getGoogleAccessToken } from './googleAuth';
import { githubTools, googleTools } from './tools';

const ghFetch = expoFetch as unknown as GitHubFetch;
const gFetch = expoFetch as unknown as GoogleFetch;

const GITHUB_SECRET = 'github.token';

export async function connectGitHub(token: string): Promise<string> {
  const trimmed = token.trim();
  if (!/^(ghp_|github_pat_|gho_|ghu_|ghs_)?[A-Za-z0-9_]{20,}$/.test(trimmed)) {
    throw new Error('That does not look like a GitHub token.');
  }
  // Validate before storing so a typo never ends up saved as "connected".
  const { login } = await createGitHubClient(trimmed, ghFetch).getUser();
  await setSecret(GITHUB_SECRET, trimmed);
  useConnectors.getState().setGitHub({ connected: true, login });
  return login;
}

export async function disconnectGitHub(): Promise<void> {
  await deleteSecret(GITHUB_SECRET);
  useConnectors.getState().setGitHub({ connected: false });
}

export async function getGitHubClient(): Promise<GitHubClient | null> {
  const token = await getSecret(GITHUB_SECRET);
  return token ? createGitHubClient(token, ghFetch) : null;
}

/**
 * Tools offered to the model for a conversation. Empty for models without
 * function calling, so on-device models simply chat.
 */
export async function buildTools(project: Project | null, modelSupportsTools: boolean): Promise<ToolExecutor[]> {
  if (!modelSupportsTools) return [];
  const { enabled, github, google } = useConnectors.getState();
  const tools: ToolExecutor[] = [];

  const repo = githubResource(project);
  if (repo && enabled.github && github.connected) {
    const client = await getGitHubClient();
    if (client) tools.push(...githubTools(client, repo.repo, repo.ref));
  }
  if (enabled.google && google.connected) {
    tools.push(...googleTools(createGoogleClient(getGoogleAccessToken, gFetch)));
  }
  return tools;
}
