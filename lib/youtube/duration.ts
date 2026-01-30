/**
 * Parse YouTube ISO 8601 duration strings to seconds.
 * E.g. PT7M30S -> 450, PT1H2M10S -> 3730
 */

export function parseIsoDurationToSeconds(iso: string): number {
  if (!iso || typeof iso !== "string") return 0;
  const s = iso.trim().toUpperCase();
  if (!s.startsWith("PT")) return 0;

  let total = 0;
  let num = "";

  for (let i = 2; i < s.length; i++) {
    const c = s[i];
    if (c >= "0" && c <= "9") {
      num += c;
    } else if (c === "H" && num) {
      total += parseInt(num, 10) * 3600;
      num = "";
    } else if (c === "M" && num) {
      total += parseInt(num, 10) * 60;
      num = "";
    } else if (c === "S" && num) {
      total += parseInt(num, 10);
      num = "";
    } else if (c === "D" && num) {
      total += parseInt(num, 10) * 86400;
      num = "";
    } else {
      return 0;
    }
  }

  return isNaN(total) ? 0 : total;
}
