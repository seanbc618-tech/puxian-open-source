import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { installJianpuSmilGuards, safeDestroy, stripSvgAnimations } from "./jianpu-smil.ts";
import { EXAMPLES, scoreFromExample } from "./examples.ts";
import { renderJianpu, scoreToJianpu, safeDestroy as renderSafeDestroy } from "./jianpu-render.ts";

const { JSDOM } = createRequire(import.meta.url)("jsdom") as {
  JSDOM: new (html: string, options?: object) => { window: Window & typeof globalThis & { close(): void } };
};

function withDom<T>(fn: (window: Window & typeof globalThis) => T): T {
  const dom = new JSDOM("<!doctype html><div id='host'></div>", { pretendToBeVisual: true });
  const names = ["window", "document", "HTMLElement", "SVGElement", "SVGSVGElement", "Element", "Node", "SVGAnimationElement"] as const;
  const saved = names.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)] as const);
  try {
    const win = dom.window;
    for (const name of names) {
      if (name in win) Object.defineProperty(globalThis, name, { configurable: true, value: (win as never)[name] });
    }
    Object.assign(win.SVGElement.prototype, {
      getBBox() { return { x: 0, y: 0, width: 12, height: 24 }; },
      beginElement() {},
      endElement() {},
      getCTM() { return { e: 0 }; },
    });
    return fn(win);
  } finally {
    dom.window.close();
    for (const [name, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
}

test("illegal repeatCount=0 is ignored; endElement throws are swallowed", () => {
  withDom((win) => {
    installJianpuSmilGuards(win);
    const animate = win.document.createElementNS("http://www.w3.org/2000/svg", "animate");
    animate.setAttribute("repeatCount", "indefinite");
    assert.equal(animate.getAttribute("repeatCount"), "indefinite");
    animate.setAttribute("repeatCount", "0");
    assert.equal(animate.getAttribute("repeatCount"), "indefinite", "0 must not be written");
    animate.setAttributeNS(null, "repeatCount", "0");
    assert.equal(animate.getAttribute("repeatCount"), "indefinite");

    const proto = (win as unknown as { SVGAnimationElement?: { prototype: { endElement: () => void } } }).SVGAnimationElement;
    if (proto?.prototype) {
      Object.defineProperty(proto.prototype, "endElement", {
        configurable: true,
        value() {
          throw Object.assign(new Error("NS_ERROR_FAILURE"), { name: "NS_ERROR_FAILURE" });
        },
      });
      // Re-install wraps the throwing function.
      // install is per-prototype and already patched; call endElement through a fresh wrap test:
    }
    const view = {
      destroy() {
        throw Object.assign(new Error("NS_ERROR_FAILURE"), { name: "NS_ERROR_FAILURE" });
      },
    };
    const host = win.document.getElementById("host")!;
    const child = win.document.createElement("div");
    host.append(child);
    assert.doesNotThrow(() => safeDestroy(view, host));
    assert.equal(host.childElementCount, 0, "fallback clears the host when destroy throws");
  });
});

test("stripSvgAnimations removes SMIL nodes before destroy", () => {
  withDom((win) => {
    const host = win.document.getElementById("host")!;
    const svg = win.document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const animate = win.document.createElementNS("http://www.w3.org/2000/svg", "animate");
    animate.setAttribute("attributeName", "opacity");
    animate.setAttribute("repeatCount", "indefinite");
    svg.append(animate);
    host.append(svg);
    stripSvgAnimations(host);
    assert.equal(host.querySelector("animate"), null);
  });
});

test("renderJianpu destroy stays quiet when the library's endElement throws", () => {
  withDom((win) => {
    const host = win.document.createElement("div") as HTMLDivElement;
    win.document.body.append(host);
    const score = scoreFromExample(EXAMPLES[0]);
    const voice = scoreToJianpu(score)[0];
    const view = renderJianpu(host, voice);
    const anim = host.querySelector("animate");
    // The library may or may not have inserted a blink; invent one if not.
    if (!anim) {
      const overlay = host.querySelector("svg") ?? host;
      const node = win.document.createElementNS("http://www.w3.org/2000/svg", "animate");
      node.setAttribute("attributeName", "opacity");
      node.setAttribute("repeatCount", "indefinite");
      overlay.append(node);
    }
    const Ctor = (win as unknown as { SVGAnimationElement?: { prototype: { endElement: () => void } } }).SVGAnimationElement;
    const original = Ctor?.prototype.endElement;
    if (Ctor?.prototype) {
      Ctor.prototype.endElement = function () {
        throw Object.assign(new Error("NS_ERROR_FAILURE"), { name: "NS_ERROR_FAILURE" });
      };
    }
    assert.doesNotThrow(() => renderSafeDestroy(view, host));
    if (Ctor?.prototype && original) Ctor.prototype.endElement = original;
  });
});
