// The desktop app's card code library: projects on disk that both editors
// and the MCP server (an AI assistant) share. The app serves its address in
// /sandbox-config.js; in a browser there's none, and the editors keep to
// browser storage.
import { runtimeConfig } from "./desktop";

export type ProjectKind = "blocks" | "code";

export type ProjectSummary = {
  id: string;
  name: string;
  kind: ProjectKind;
  description: string;
  updatedAt: string;
  envKeys: string[];
};

export type Project = ProjectSummary & {
  main: string;
  env: Record<string, string>;
  workspace?: unknown;
};

// In the app's development mode Vite serves the editor, so the address
// comes from the build environment instead.
export const libraryUrl = (): string | undefined =>
  (
    runtimeConfig().libraryUrl ??
    (import.meta.env.VITE_LIBRARY_URL as string | undefined)
  )?.replace(/\/$/, "") || undefined;

export const hasLibrary = () => Boolean(libraryUrl());

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const base = libraryUrl();
  if (!base)
    throw new Error("The card code library is only in the desktop app.");
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...init?.headers },
    });
  } catch {
    throw new Error(
      "Couldn't reach the card code library. Is the MCP server running?",
    );
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) {
    throw Object.assign(
      new Error(body.error ?? `The library returned ${response.status}.`),
      {
        status: response.status,
      },
    );
  }
  return body as T;
}

export const listProjects = () => call<ProjectSummary[]>("/api/projects");

export const getProject = (id: string) =>
  call<Project>(`/api/projects/${encodeURIComponent(id)}`);

export const createProject = (input: {
  name: string;
  kind: ProjectKind;
  main?: string;
  env?: Record<string, string>;
  workspace?: unknown;
}) =>
  call<Project>("/api/projects", {
    method: "POST",
    body: JSON.stringify(input),
  });

export const saveProject = (
  id: string,
  patch: { main?: string; env?: Record<string, string>; workspace?: unknown },
) =>
  call<Project>(`/api/projects/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });

/** Calls back with the ids of projects changed on disk (by anyone). */
export function watchProjects(onChanged: (ids: string[]) => void): () => void {
  const base = libraryUrl();
  if (!base || typeof EventSource === "undefined") return () => {};
  const source = new EventSource(`${base}/api/events`);
  source.addEventListener("changed", (event) => {
    try {
      onChanged(
        (JSON.parse((event as MessageEvent).data) as { ids: string[] }).ids,
      );
    } catch {
      // A malformed event; the next one will do.
    }
  });
  return () => source.close();
}

/** Calls back with the library's projects, now and whenever they change. */
export function watchProjectList(
  onList: (projects: ProjectSummary[]) => void,
): () => void {
  if (!hasLibrary()) return () => {};
  const refresh = () => listProjects().then(onList, () => {});
  refresh();
  return watchProjects(refresh);
}
