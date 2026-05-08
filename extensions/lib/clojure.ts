const CLOJURE_FILE_RE = /\.(?:clj|cljs|cljc|cljd|edn|bb)$/i;

export function isClojurePath(path: string): boolean {
  return CLOJURE_FILE_RE.test(path);
}
