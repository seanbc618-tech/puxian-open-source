/**
 * JianpuRender 1.8.1 stops its signature blink with
 * `animate.endElement()` then `repeatCount="0"`.
 * Firefox treats 0 as illegal SMIL and later throws NS_ERROR_FAILURE
 * from endElement/destroy, which unmounted the whole app and left the
 * boot splash ("正在打开谱线…") on screen.
 */
const ANIM_TAGS = "animate, animateTransform, animateMotion, set";

const patched = new WeakSet<object>();

function isIllegalRepeatCount(name: string, value: string): boolean {
  return name === "repeatCount" && (value === "0" || value === "0.0");
}

function wrapCall(original: () => void): () => void {
  return function (this: object) {
    try {
      return original.call(this);
    } catch {
      /* Firefox NS_ERROR_FAILURE on invalid or finished SMIL */
    }
  };
}

/** Idempotent per window / prototype. Safe in Node tests, jsdom, or the browser. */
export function installJianpuSmilGuards(target: object = globalThis): void {
  const bag = target as {
    SVGAnimationElement?: { prototype: Record<string, unknown> };
    Element?: { prototype: object };
  };
  const animation = bag.SVGAnimationElement;
  if (animation?.prototype && !patched.has(animation.prototype)) {
    for (const name of ["beginElement", "endElement"] as const) {
      const original = animation.prototype[name];
      if (typeof original !== "function") continue;
      Object.defineProperty(animation.prototype, name, {
        configurable: true,
        value: wrapCall(original as () => void),
      });
    }
    patched.add(animation.prototype);
  }
  const proto = bag.Element?.prototype as
    | {
        setAttribute: (name: string, value: string) => void;
        setAttributeNS: (ns: string | null, name: string, value: string) => void;
      }
    | undefined;
  if (proto && !patched.has(proto)) {
    const setAttr = proto.setAttribute;
    const setAttrNS = proto.setAttributeNS;
    proto.setAttribute = function (name: string, value: string) {
      if (isIllegalRepeatCount(String(name), String(value))) return;
      return setAttr.call(this, name, value);
    };
    proto.setAttributeNS = function (ns: string | null, name: string, value: string) {
      if (isIllegalRepeatCount(String(name), String(value))) return;
      return setAttrNS.call(this, ns, name, value);
    };
    patched.add(proto);
  }
}

export function stripSvgAnimations(root: ParentNode | null | undefined): void {
  if (!root || typeof root.querySelectorAll !== "function") return;
  try {
    root.querySelectorAll(ANIM_TAGS).forEach((el) => {
      try {
        el.remove();
      } catch {
        /* already detached */
      }
    });
  } catch {
    /* query failed on a detached node */
  }
}

export function safeDestroy(
  view: { destroy?: () => void } | null | undefined,
  host?: ParentNode | null,
): void {
  const root = host ?? null;
  const scope =
    root && "ownerDocument" in root && (root as Element).ownerDocument?.defaultView
      ? ((root as Element).ownerDocument!.defaultView as object)
      : globalThis;
  installJianpuSmilGuards(scope);
  stripSvgAnimations(root);
  try {
    view?.destroy?.();
  } catch {
    try {
      if (root && "replaceChildren" in root) {
        (root as ParentNode & { replaceChildren: () => void }).replaceChildren();
      }
    } catch {
      /* last resort failed; the host may already be gone */
    }
  }
}
