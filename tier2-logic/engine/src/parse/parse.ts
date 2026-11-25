/**
 * `parse` (engine.py L110-113). Python caches every expression in the module-global `_AST`; here the
 * cache is passed in, one per `compile` (PORTING.md D6), so its memory goes with the compiled model.
 */
import type { Ast } from './ast';
import { Parser } from './parser';

/** Source text → AST. ASTs are immutable, so one AST serves every cell that uses the expression. */
export type ParseCache = Map<string, Ast>;

/** Parse `src` (SYNTAX error with position and source on bad input); with `cache`, each text once. */
export function parse(src: string, cache?: ParseCache): Ast {
  const hit = cache?.get(src);
  if (hit) return hit;
  const ast = new Parser(src).parse();
  cache?.set(src, ast);
  return ast;
}
