/**
 * Arguments for the verify scripts' static server: the same stdlib server as
 * `python3 -m http.server`, but with a deeper listen backlog. The default of 5 can drop a
 * lazy chunk while several browsers load the app at once (docs/verify-stability.md).
 */
export const PYTHON_SERVER = [
  "import functools, http.server, sys",
  "port, host, root = int(sys.argv[1]), sys.argv[2], sys.argv[3]",
  "http.server.ThreadingHTTPServer.request_queue_size = 128",
  "handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=root)",
  "http.server.ThreadingHTTPServer((host, port), handler).serve_forever()",
].join("\n");

export function pythonServerArgs(port, host, root) {
  return ["-c", PYTHON_SERVER, String(port), host, root];
}
