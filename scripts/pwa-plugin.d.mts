import type { Plugin } from 'vite';

export const THEME_COLOR: string;
export const BACKGROUND_COLOR: string;
export function manifest(): {
  id: string;
  name: string;
  short_name: string;
  start_url: string;
  scope: string;
  display: string;
  background_color: string;
  theme_color: string;
  icons: { src: string; sizes: string; type: string; purpose: string }[];
};
export function serviceWorkerSource(version: string, files: string[]): string;
export function precacheList(files: string[]): string[];
export function versionOf(dir: string, files: string[]): string;
export function pwa(mode: string): Plugin;
