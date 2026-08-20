const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Parses `Name <a@b.c>` or a bare address; null for anything that is not one. */
export function addressOf(input: string | { address?: string; email?: string; name?: string; usrId?: number }, name = "") {
  let address = "";
  if (typeof input === "string") {
    const match = input.match(/^\s*(.*?)\s*<([^>]+)>\s*$/);
    if (match) { name ||= match[1].replace(/^"|"$/g, ""); address = match[2]; }
    else address = input;
  } else {
    address = input.address ?? input.email ?? "";
    name ||= input.name ?? "";
  }
  address = address.trim().toLowerCase();
  if (!EMAIL_RE.test(address)) return null;
  return { address, name: name || undefined, usrId: typeof input === "object" ? input.usrId : undefined };
}

/** The `Name <a@b.c>` form a transport expects. */
export function formatAddress({ address, name }: { address: string; name?: string }): string {
  return name ? `${name.replace(/"/g, '\\"')} <${address}>` : address;
}
