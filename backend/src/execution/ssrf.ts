import * as dns from 'node:dns';
import * as net from 'node:net';

/**
 * The address policy — what a send is allowed to connect to.
 *
 * ⚠️ **Screening and connecting must be one act.** This module resolves a
 * hostname to concrete addresses and screens *all* of them; the caller then
 * pins the connection to one of those addresses through a `lookup` function
 * (see `http-client.ts`). Screening a *hostname* and letting Node re-resolve it
 * later is a DNS-rebinding hole that passes every hand test, because the attack
 * needs a second query to fire.
 *
 * ⚠️ The unwrapping cases below are where naive implementations lose:
 * `http://[::ffff:127.0.0.1]/`, `http://[64:ff9b::7f00:1]/` and
 * `http://[2002:7f00:1::]/` all reach loopback while passing a range check that
 * only knows about `::1`.
 */

/** Marks an address the policy refuses. Carries no upstream detail. */
export class BlockedAddressError extends Error {
  constructor(readonly address: string) {
    super(`Address ${address} is not allowed`);
    this.name = 'BlockedAddressError';
  }
}

/** DNS resolution itself failed — a different outcome from "blocked". */
export class DnsFailureError extends Error {
  constructor(readonly hostname: string) {
    super(`Could not resolve ${hostname}`);
    this.name = 'DnsFailureError';
  }
}

function ipv4ToOctets(ip: string): number[] | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return null;
  }
  return octets;
}

/**
 * `true` if this IPv4 address is outside the public internet.
 *
 * Every range here has a spec case. `169.254/16` matters most of all: it
 * contains `169.254.169.254`, the cloud metadata endpoint, which is the single
 * most valuable target an SSRF reaches.
 */
function isBlockedIpv4(ip: string): boolean {
  const octets = ipv4ToOctets(ip);
  if (!octets) return true; // unparseable — fail closed
  const [a, b] = octets;

  if (a === 0) return true; // 0.0.0.0/8 "this host"
  if (a === 10) return true; // RFC1918
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
  if (a === 192 && b === 168) return true; // RFC1918
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT 100.64/10
  if (a === 192 && b === 0 && octets[2] === 0) return true; // 192.0.0/24
  if (a === 192 && b === 0 && octets[2] === 2) return true; // TEST-NET-1
  if (a === 198 && (b === 18 || b === 19)) return true; // 198.18/15 benchmarking
  if (a === 198 && b === 51 && octets[2] === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && octets[2] === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast 224/4, reserved 240/4, broadcast

  return false;
}

/** Expands any valid IPv6 text form into its eight 16-bit groups. */
function ipv6Groups(ip: string): number[] | null {
  let text = ip;

  // A trailing dotted-quad (`::ffff:127.0.0.1`) becomes two hex groups.
  const dotted = /:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (dotted) {
    const octets = ipv4ToOctets(dotted[1]);
    if (!octets) return null;
    const high = ((octets[0] << 8) | octets[1]).toString(16);
    const low = ((octets[2] << 8) | octets[3]).toString(16);
    text = `${text.slice(0, dotted.index)}:${high}:${low}`;
  }

  const halves = text.split('::');
  if (halves.length > 2) return null;

  const parse = (part: string): number[] | null => {
    if (part === '') return [];
    const groups: number[] = [];
    for (const chunk of part.split(':')) {
      if (!/^[0-9a-fA-F]{1,4}$/.test(chunk)) return null;
      groups.push(parseInt(chunk, 16));
    }
    return groups;
  };

  const head = parse(halves[0]);
  const tail = halves.length === 2 ? parse(halves[1]) : [];
  if (!head || !tail) return null;

  if (halves.length === 2) {
    const fill = 8 - head.length - tail.length;
    if (fill < 0) return null;
    return [...head, ...Array<number>(fill).fill(0), ...tail];
  }
  return head.length === 8 ? head : null;
}

const groupsToIpv4 = (high: number, low: number): string =>
  [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');

/**
 * `true` if this IPv6 address is outside the public internet, **including**
 * every form that embeds an IPv4 address. Each embedding is unwrapped and
 * re-checked as IPv4 rather than being matched as a v6 range, because the
 * embedded address is the one the packet actually reaches.
 */
function isBlockedIpv6(ip: string): boolean {
  const groups = ipv6Groups(ip.split('%')[0]); // drop any zone id
  if (!groups) return true; // unparseable — fail closed

  const [g0, g1, g2, g3, g4, g5, g6, g7] = groups;

  // ::ffff:a.b.c.d — IPv4-mapped. Node normalizes the dotted form to hex.
  if (g0 === 0 && g1 === 0 && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0xffff) {
    return isBlockedIpv4(groupsToIpv4(g6, g7));
  }

  // 64:ff9b::/96 — NAT64.
  if (g0 === 0x64 && g1 === 0xff9b && g2 === 0 && g3 === 0 && g4 === 0 && g5 === 0) {
    return isBlockedIpv4(groupsToIpv4(g6, g7));
  }

  // 2002::/16 — 6to4 carries its IPv4 in the next two groups.
  if (g0 === 0x2002) return isBlockedIpv4(groupsToIpv4(g1, g2));

  if (groups.every((group) => group === 0)) return true; // :: unspecified
  if (groups.slice(0, 7).every((g) => g === 0) && g7 === 1) return true; // ::1
  if ((g0 & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local (incl. AWS IMDSv6)
  if ((g0 & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((g0 & 0xff00) === 0xff00) return true; // ff00::/8 multicast

  return false;
}

/**
 * The screening predicate. Pure and table-tested.
 *
 * Anything that is not a recognisable IP literal is blocked: this is only ever
 * called with an address that already came out of `net.isIP` or `dns.lookup`,
 * so an unparseable one means something upstream changed and failing closed is
 * the only safe answer.
 */
export function isBlockedAddress(ip: string): boolean {
  const family = net.isIP(ip);
  if (family === 4) return isBlockedIpv4(ip);
  if (family === 6) return isBlockedIpv6(ip);
  return true;
}

/**
 * WHATWG `url.hostname` for `http://[::1]/` is `"[::1]"` — brackets included —
 * and `net.isIP('[::1]')` is `0`.
 *
 * ⚠️ Without stripping them **every IPv6 literal falls through the literal
 * check** into `dns.lookup`, which then fails on the bracketed form. That fails
 * *closed* (as `dns`, not as a bypass), but it means the entire IPv6 half of
 * the table above becomes dead code reached by nothing.
 */
export function stripBrackets(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

export interface ResolveAndScreenOptions {
  /**
   * When true, step 4 (screening) is skipped. DNS still runs and the caller
   * still pins. For local development only — `SEND_ALLOW_PRIVATE_NETWORK`.
   */
  allowPrivateNetwork: boolean;
  /** Injected so tests can allow `127.0.0.1` while blocking a marker address. */
  isBlockedAddress: (ip: string) => boolean;
  /** Injected so the resolver can be stubbed without touching real DNS. */
  lookup?: typeof dns.promises.lookup;
}

/**
 * Resolves a hostname to the addresses a connection may be pinned to.
 *
 * ⚠️ Pass `url.hostname`, **never the raw input**. `new URL()` normalizes
 * decimal, octal, hex and short IPv4 forms for `http:` (`http://2130706433/`
 * becomes `127.0.0.1`), and that normalization is exactly what makes those
 * forms safe here.
 *
 * ⚠️ **Every** returned address is screened, and if *any* is blocked the whole
 * send fails. Not "filter and use the survivors" — a name resolving to both a
 * public and a private address is a rebinding attack, and picking the public
 * one only delays it.
 */
export async function resolveAndScreen(
  hostname: string,
  options: ResolveAndScreenOptions,
): Promise<string[]> {
  const host = stripBrackets(hostname);
  const screen = (addresses: string[]): string[] => {
    if (!options.allowPrivateNetwork) {
      for (const address of addresses) {
        if (options.isBlockedAddress(address)) {
          throw new BlockedAddressError(address);
        }
      }
    }
    return addresses;
  };

  if (net.isIP(host) !== 0) return screen([host]);

  const lookup = options.lookup ?? dns.promises.lookup;
  let records: dns.LookupAddress[];
  try {
    records = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new DnsFailureError(host);
  }

  const addresses = records.map((record) => record.address);
  if (addresses.length === 0) throw new DnsFailureError(host);

  return screen(addresses);
}

/** `http:` and `https:` only. No `file:`, no `ftp:`, no `data:`. */
export const ALLOWED_PROTOCOLS = ['http:', 'https:'] as const;

export function isAllowedProtocol(protocol: string): boolean {
  return (ALLOWED_PROTOCOLS as readonly string[]).includes(protocol);
}
