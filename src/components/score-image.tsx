import { useRef } from "react";
import { quiet } from "./ui/styles";

export function ScoreImageUpload({ onSelect, className }: { onSelect: (files: File[]) => void; className?: string }) {
  const input = useRef<HTMLInputElement>(null);
  return <>
    <button type="button" className={className ?? quiet} onClick={() => input.current?.click()}>识别图片</button>
    <input ref={input} type="file" tabIndex={-1} multiple accept=".png,.jpg,.jpeg,.webp,.pdf,application/pdf" className="upload-file-hidden"
      aria-label="上传谱子图片文件" onChange={(event) => {
        const files = Array.from(event.target.files ?? []);
        event.target.value = "";
        if (files.length) onSelect(files);
      }} />
  </>;
}
