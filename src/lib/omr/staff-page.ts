/**
 * Browser SMT only reads a piano grand staff (two staves). A single printed
 * staff is a real staff, not a failed scan. Titles and note names can add
 * extra dark rows; those rows do not make a second staff and must not be
 * described as a reason to crop. There is no crop control in the product.
 */
export function browserStaffRefusal(lineCount: number, staffCount: number): string | null {
  if (staffCount >= 2) return null;
  if (staffCount === 1) {
    return "这一页是单行五线谱。浏览器里的后备识别只读钢琴大谱表（高音谱表和低音谱表连成一组）。单行谱请用本站识别服务。";
  }
  // Many short rules and no five-line staff: numbered notation, not a piano system.
  if (lineCount >= 8) return "暂不支持简谱。请改上传端正清晰的印刷体五线谱。";
  return "这不像五线谱。柱状图、照片和其他非谱面不能识别。";
}
