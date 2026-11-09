export type TestProjects = { unit: string[]; ui: string[]; integration: string[] }
export function discoverTestProjects(root: string): TestProjects
