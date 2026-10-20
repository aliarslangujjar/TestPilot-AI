/**
 * Minimal GitHub REST API client for the Actions integration.
 *
 * Server-only. The token is a repo-scoped fine-grained PAT supplied by
 * the workspace (see docs/GITHUB_ACTIONS.md for exact permissions). All
 * calls are plain REST requests — this client never downloads, clones,
 * or executes repository code.
 */

const API_BASE = "https://api.github.com";

export class GitHubApiError extends Error {
  readonly status: number;
  readonly rateLimited: boolean;

  constructor(status: number, message: string, rateLimited = false) {
    super(message);
    this.name = "GitHubApiError";
    this.status = status;
    this.rateLimited = rateLimited;
  }
}

async function githubFetch(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "X-GitHub-Api-Version": "2022-11-28",
        "User-Agent": "TestPilot-AI",
        ...(init.headers ?? {}),
      },
    });
  } catch {
    throw new GitHubApiError(0, "Could not reach the GitHub API.");
  }

  if (!res.ok) {
    const rateLimited =
      res.status === 429 ||
      (res.status === 403 && res.headers.get("x-ratelimit-remaining") === "0");
    let detail = "";
    try {
      const body = (await res.json()) as { message?: string };
      detail = body.message ?? "";
    } catch {
      // Non-JSON error body — status alone is enough.
    }
    throw new GitHubApiError(
      res.status,
      rateLimited
        ? "GitHub API rate limit reached. Wait a while and try again."
        : `GitHub API error (${res.status})${detail ? `: ${detail}` : ""}`,
      rateLimited,
    );
  }
  return res;
}

export async function getGitHubRepo(
  token: string,
  owner: string,
  repo: string,
): Promise<{ fullName: string }> {
  const res = await githubFetch(token, `/repos/${owner}/${repo}`);
  const body = (await res.json()) as { full_name: string };
  return { fullName: body.full_name };
}

export async function getGitHubWorkflow(
  token: string,
  owner: string,
  repo: string,
  workflowFile: string,
): Promise<{ name: string; state: string }> {
  const res = await githubFetch(token, `/repos/${owner}/${repo}/actions/workflows/${workflowFile}`);
  const body = (await res.json()) as { name: string; state: string };
  return { name: body.name, state: body.state };
}

/**
 * Trigger a workflow_dispatch run. GitHub answers 204 with no run id —
 * the run is correlated later via the workflow_run webhook.
 * `inputs` are plain strings, already schema-validated by the caller.
 */
export async function dispatchGitHubWorkflow(
  token: string,
  params: {
    owner: string;
    repo: string;
    workflowFile: string;
    ref: string;
    inputs: Record<string, string>;
  },
): Promise<void> {
  await githubFetch(
    token,
    `/repos/${params.owner}/${params.repo}/actions/workflows/${params.workflowFile}/dispatches`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ref: params.ref, inputs: params.inputs }),
    },
  );
}

/** Publish a commit status (used to surface the QA result on the commit). */
export async function createGitHubCommitStatus(
  token: string,
  params: {
    owner: string;
    repo: string;
    sha: string;
    state: "success" | "failure" | "error" | "pending";
    targetUrl: string;
    description: string;
  },
): Promise<void> {
  await githubFetch(token, `/repos/${params.owner}/${params.repo}/statuses/${params.sha}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      state: params.state,
      target_url: params.targetUrl,
      description: params.description.slice(0, 140),
      context: "testpilot/qa",
    }),
  });
}
