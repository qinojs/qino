/** Score key: IPv4 as is, IPv6 as its /64 network (one connection can rotate within it). */
export function ipKey(ip: string): string {
  if (!ip.includes(":") || ip.includes(".")) return ip; // IPv4, also IPv4-mapped IPv6
  const [head, tail] = ip.split("%")[0].toLowerCase().split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const groups = [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right];
  return groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":") + "::/64";
}
