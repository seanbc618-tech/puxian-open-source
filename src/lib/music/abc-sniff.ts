/** ABC sniffing kept apart from the ABC reader/writer, so the editor loads `abc.ts` only for ABC. */
/** True when the text reads like ABC (X:/K: headers and letter notes) rather than a jianpu dialect. */
export function sniffAbc(text: string): boolean {
  if (!/^K:/m.test(text) || !/^(X|T|M|L):/m.test(text)) return false;
  const body = text.split("\n").filter((l) => !/^[A-Za-z]:|^%/.test(l)).join(" ").replace(/"[^"]*"|![^!]*!/g, " ");
  const letters = (body.match(/[A-Ga-g][,']*\d*/g) ?? []).length;
  const digits = (body.match(/(^|[\s|])[0-7][.,']*/g) ?? []).length;
  return letters > 0 && letters > digits;
}
