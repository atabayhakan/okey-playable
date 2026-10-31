// The project does not pull in the Node typings; this is the one Node function the tests read files with.
declare module 'node:fs' {
  export function readFileSync(path: URL | string, encoding: 'utf8'): string;
}
