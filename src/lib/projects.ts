/** Project model and system-prompt assembly. Pure (no native imports). */

export type ProjectResource =
  | { id: string; kind: 'github'; repo: string; ref?: string }
  | { id: string; kind: 'file'; name: string; content: string; source?: string };

/** A resource before it is assigned an id. (`Omit` does not distribute over unions.) */
export type NewResource = ProjectResource extends infer R ? (R extends { id: string } ? Omit<R, 'id'> : never) : never;

export interface Project {
  id: string;
  name: string;
  /** Extra instructions appended to the system prompt for every conversation in the project. */
  instructions: string;
  resources: ProjectResource[];
  createdAt: number;
}

/** Total characters of pinned file content included in a system prompt. */
export const PINNED_CONTEXT_BUDGET = 24_000;

export function githubResource(project: Project | null | undefined) {
  return project?.resources.find((r): r is Extract<ProjectResource, { kind: 'github' }> => r.kind === 'github') ?? null;
}

export function buildSystemPrompt(base: string, project: Project | null | undefined, budget = PINNED_CONTEXT_BUDGET): string {
  const parts: string[] = [base.trim()];
  if (!project) return parts.join('\n\n');

  parts.push(`You are working in the project "${project.name}".`);
  if (project.instructions.trim()) parts.push(`Project instructions:\n${project.instructions.trim()}`);

  const repo = githubResource(project);
  if (repo) {
    parts.push(
      `The GitHub repository ${repo.repo}${repo.ref ? ` (ref: ${repo.ref})` : ''} is attached. ` +
        'If tools are available, use them to browse and read files instead of guessing.',
    );
  }

  let remaining = budget;
  const files = project.resources.filter((r): r is Extract<ProjectResource, { kind: 'file' }> => r.kind === 'file');
  const blocks: string[] = [];
  for (const f of files) {
    if (remaining <= 200) {
      blocks.push(`(${f.name} omitted: context budget reached)`);
      continue;
    }
    const body = f.content.length > remaining ? `${f.content.slice(0, remaining)}\n…[truncated]` : f.content;
    remaining -= body.length;
    blocks.push(`### ${f.name}\n\`\`\`\n${body}\n\`\`\``);
  }
  if (blocks.length) parts.push(`Attached files:\n\n${blocks.join('\n\n')}`);
  return parts.join('\n\n');
}
