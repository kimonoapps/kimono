/*
 * For tests that load Portal's own server code. Next resolves three things
 * plain Node doesn't: imports without ".ts", the "@/" alias for src/, and its
 * own entry points without ".js" ("next/headers"). This hook does the same,
 * and stands in for sign-in (@/auth), which only works inside Next.
 * Use with: node --experimental-transform-types --import ./scripts/ts-resolve.mjs --conditions=react-server …
 */
import { register } from 'node:module';

const src = new URL('../src/', import.meta.url).href;

register('data:text/javascript,' + encodeURIComponent(`
const src = ${JSON.stringify(src)};
const endings = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];
async function first(candidates, context, next, error) {
  for (const candidate of candidates) {
    try { return await next(candidate, context); } catch {}
  }
  throw error;
}
/* Signing in needs Next itself; code under test never signs anyone in. */
const stubs = {
  /* A marker Next provides; outside Next it would throw, and installing it confuses Next's own. */
  'server-only': '',
  /* Draws through glyphs.tsx, JSX plain Node can't load; no test looks at the picture. */
  '@kimono/ui/bloom-svg': 'export const bloomSvg = () => "<svg/>";',
  '@/auth': 'export const auth = async () => null; export const roleFromGroups = () => "member"; export const signIn = async () => {}; export const signOut = async () => {};',
};
export async function resolve(specifier, context, next) {
  if (specifier in stubs) return { url: 'data:text/javascript,' + encodeURIComponent(stubs[specifier]), shortCircuit: true };
  try { return await next(specifier, context); } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND' && error.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') throw error;
    if (specifier.startsWith('@/')) return first(endings.map((e) => src + specifier.slice(2) + e), context, next, error);
    if (specifier.startsWith('next/')) return first([specifier + '.js'], context, next, error);
    if (/^\\.{1,2}\\//.test(specifier)) return first(endings.slice(1).map((e) => specifier + e), context, next, error);
    throw error;
  }
}`), import.meta.url);
