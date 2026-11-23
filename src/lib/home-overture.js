export const OVERTURE_VIEWBOX = "0 0 600 120";
export const STAFF_YS = [40, 50, 60, 70, 80];
const P = [108, 80, 160, 75, 216, 70, 268, 65, 324, 60, 376, 55, 432, 50, 484, 55];
export const OVERTURE_INNER = (() => {
  let stems = "", heads = "", flags = "", beams = "";
  const sx = [], sy = [], up = [];
  for (let i = 0; i < 8; i++) {
    const x = P[i * 2], y = P[i * 2 + 1], u = y > 60, x2 = x + (u ? 5.4 : -5.4), y2 = y + (u ? -35 : 35);
    sx.push(x2); sy.push(y2); up.push(u);
    stems += `M${x2} ${y}V${y2}`;
    heads += `<ellipse class="px-head" cx="${x}" cy="${y}" rx="6.2" ry="4.1" transform="rotate(-20 ${x} ${y})" style="--i:${i}"/>`;
    if (i > 5) flags += `<path data-pen="" d="M${x2} ${y2}c2 0 12-2 13-11 1-8-2-16-4-21 3 8 1 16-9 24z"/>`;
  }
  for (let i = 0; i < 6; i += 2) {
    const t = up[i] ? 5 : -5;
    beams += `<path d="M${sx[i]} ${sy[i]}L${sx[i + 1]} ${sy[i + 1]} ${sx[i + 1]} ${sy[i + 1] + t} ${sx[i]} ${sy[i] + t}Z"/>`;
  }
  return `<g fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><path opacity=".15" d="M0 40H600M0 50H600M0 60H600M0 70H600M0 80H600"/><path data-pen="" d="M36 92c1 10 16 9 16-3 0-16-20-9-20-26 0-16 14-24 26-18 14 6 14 26 0 34-16 10-4-22 10-34 11-11 6-26-9-28-18-2-26 18-10 26-10 0-18-18-4-28 18-14 38 10 28 34-8 20-30 24-37 8"/><path data-pen="" d="M536 40V80"/><path data-pen="" d="M544 40V80" stroke-width="3.2"/><path data-pen="" d="${stems}"/><g fill="currentColor" stroke="none">${flags}${beams}${heads}</g></g>`;
})();
