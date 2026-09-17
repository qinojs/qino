/** What a score belongs to: an IPv4 address as is, an IPv6 address as its /64 network, the part
 *  a single connection holds and can rotate the rest of. */
export function ipKey(ip: string): string {
  if (!ip.includes(":") || ip.includes(".")) return ip; // IPv4, also IPv4-mapped IPv6
  const [head, tail] = ip.split("%")[0].toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
