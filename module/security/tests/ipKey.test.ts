import { assertEquals } from "@qino/qino/tests";

import { ipKey } from "../lib/ipKey.ts";

Deno.test("ipKey: IPv4 as is, IPv6 as its /64", () => {
  assertEquals(ipKey("1.2.3.4"), "1.2.3.4");
  assertEquals(ipKey("::ffff:1.2.3.4"), "::ffff:1.2.3.4");
  assertEquals(ipKey("2a02:1210:3c4d:4200:bc73:f023:7666:bd65"), "2a02:1210:3c4d:4200::/64");
  assertEquals(ipKey("2A02:1210:3C4D:4200::1"), "2a02:1210:3c4d:4200::/64");
  assertEquals(ipKey("2a02:1210::1"), "2a02:1210:0:0::/64");
  assertEquals(ipKey("2a02:0db8:0000:0042:1::"), "2a02:db8:0:42::/64");
  assertEquals(ipKey("fe80::1%eth0"), "fe80:0:0:0::/64");
  assertEquals(ipKey("::1"), "0:0:0:0::/64");
});
