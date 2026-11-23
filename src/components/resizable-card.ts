import { createElement, forwardRef, useEffect, useRef, type ElementType, type HTMLAttributes, type ReactNode, type Ref } from "react";
import { attachResizeHandle } from "../lib/card-size";

type Axes = "both" | "width" | "height";

function mergeRef<T>(...refs: (Ref<T> | undefined)[]) {
  return (node: T) => {
    for (const ref of refs) {
      if (!ref) continue;
      if (typeof ref === "function") ref(node);
      else (ref as { current: T }).current = node;
    }
  };
}

/** Functional-card wrapper with a remembered resize handle. Implemented without JSX so it can live in the lazy "input" chunk without pulling jsx-runtime onto the home entry. */
export const ResizableCard = forwardRef(function ResizableCard({
  storageId,
  handleLabel = "调整卡片大小",
  minWidth,
  minHeight,
  maxWidth,
  maxHeight,
  axes = "both",
  as: Tag = "div",
  className,
  children,
  ...rest
}: {
  storageId: string;
  handleLabel?: string;
  minWidth?: number;
  minHeight?: number;
  maxWidth?: number;
  maxHeight?: number;
  axes?: Axes;
  as?: ElementType;
  className?: string;
  children?: ReactNode;
} & HTMLAttributes<HTMLElement>, forwardedRef: Ref<HTMLElement>) {
  const innerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    return attachResizeHandle(el, {
      id: storageId,
      label: handleLabel,
      minWidth,
      minHeight,
      maxWidth,
      maxHeight,
      axes,
    });
  }, [storageId, handleLabel, minWidth, minHeight, maxWidth, maxHeight, axes]);
  return createElement(
    Tag,
    {
      ref: mergeRef(innerRef, forwardedRef),
      className: ["px-card-resizable", className].filter(Boolean).join(" "),
      "data-px-card": storageId,
      ...rest,
    },
    children,
  );
});
