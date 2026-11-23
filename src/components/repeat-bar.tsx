import type { JumpAction, RepeatAction } from "@/lib/music/repeats";

/** Bar-level repeat signs, 1st / 2nd endings and D.C. / D.S. / Fine / Coda for the bar of the selected note. */
export function RepeatBar({ summary, jumps, canEdit, onEdit, onJump, quiet }: {
  summary: string;
  jumps: string;
  canEdit: boolean;
  onEdit: (action: RepeatAction) => void;
  onJump: (action: JumpAction) => void;
  quiet: string;
}) {
  const actions: [RepeatAction, string][] = [
    ["start", "|: 反复开始"],
    ["end", ":| 反复结束"],
    ["first", "一房 1."],
    ["second", "二房 2."],
    ["clear", "清除反复"],
  ];
  const jumpActions: [JumpAction, string][] = [
    ["dc", "D.C. 回开头"],
    ["ds", "D.S. 回记号"],
    ["segno", "Segno 记号"],
    ["fine", "Fine 结束"],
    ["toCoda", "To Coda"],
    ["coda", "Coda 尾声"],
    ["clearJumps", "清除跳转"],
  ];
  return (
    <div className="tool-group mt-3" data-repeat-bar="">
      <p className="tool-group-title">
        反复与跳房子<span>按选中音所在的小节</span>
      </p>
      <div className="flex flex-wrap gap-2" role="group" aria-label="反复记号">
        {actions.map(([action, label]) => (
          <button key={action} type="button" className={quiet} disabled={!canEdit} onClick={() => onEdit(action)}>
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted" data-repeat-summary="">
        {summary || "没有反复：从头奏到尾。选中谱上的音后可设反复开始 / 结束；一房放在反复段末尾，二房紧接其后。"}
      </p>
      <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="跳转记号">
        {jumpActions.map(([action, label]) => (
          <button key={action} type="button" className={quiet} disabled={!canEdit} onClick={() => onJump(action)}>
            {label}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted" data-jump-summary="">
        {jumps || "没有跳转。D.C. / D.S. 放在要跳回的小节末尾；再设 Fine（al Fine）或 To Coda + Coda（al Coda）。再点一次同一位置可去掉。"}
      </p>
    </div>
  );
}
