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

/** RFC 5322 specials: an ASCII display name holding one must be a quoted string. */
const SPECIALS = /[()<>[\]:;@\\,."]/;

/** The mailbox a transport sends to or from. Upyo writes an ASCII name as given, so a name like
 *  `Ada, Example` is quoted here — unquoted, its comma splits the header into two addresses.
 *  Non-ASCII names become encoded words, which need no quotes. */
export function formatAddress({ address, name }: { address: string; name?: string }): { address: string; name?: string } {
  if (!name) return { address };
  const quote = /^[\x20-\x7E]*$/.test(name) && SPECIALS.test(name);
  return { address, name: quote ? `"${name.replace(/[\\"]/g, "\\$&")}"` : name };
}
