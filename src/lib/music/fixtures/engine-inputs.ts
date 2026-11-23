/** Synthetic source inputs; no repertoire data. Durations use quarter-note units. */
export const noteXml = (step: string, duration: number, extra = "", alter = 0) =>
  `<note>${extra}<pitch><step>${step}</step><alter>${alter}</alter><octave>4</octave></pitch><duration>${duration}</duration><voice>1</voice></note>`;
export const xmlScore = (measures: string[], divisions = 1) =>
  `<score-partwise version="3.1"><part id="P1">${measures.map((body, i) => `<measure number="${i + 1}">${i ? "" : `<attributes><divisions>${divisions}</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time></attributes>`}${body}</measure>`).join("")}</part></score-partwise>`;

/** SMF format 0 at an intentionally non-power-of-two PPQ. */
export function fragmentedMidi(division = 101): Uint8Array {
  const track = [
    0, 0x90, 60, 90, 1, 0x80, 60, 0, 1, 0x90, 62, 90, 1, 0x80, 62, 0, 0, 0xff, 0x2f, 0,
  ];
  return new Uint8Array([
    0x4d,
    0x54,
    0x68,
    0x64,
    0,
    0,
    0,
    6,
    0,
    0,
    0,
    1,
    division >> 8,
    division & 255,
    0x4d,
    0x54,
    0x72,
    0x6b,
    0,
    0,
    0,
    track.length,
    ...track,
  ]);
}
