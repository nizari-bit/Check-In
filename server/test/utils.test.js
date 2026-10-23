import { test } from "node:test";
import assert from "node:assert/strict";
import { config } from "../src/config.js";
import {
  generateCode,
  normalizeCode,
  capacityOf,
  parseCardType,
  clean,
  eventExpiry,
  isEventAccessOpen,
  normName,
  normPhone,
  isSameGuest,
} from "../src/utils.js";

test("generateCode makes IDs like A3F-9C2", () => {
  for (let i = 0; i < 50; i++)
    assert.match(generateCode(), /^[0-9A-F]{3}-[0-9A-F]{3}$/);
});

test("normalizeCode accepts messy input", () => {
  assert.equal(normalizeCode("a3f9c2"), "A3F-9C2");
  assert.equal(normalizeCode("a3f-9c2"), "A3F-9C2");
  assert.equal(normalizeCode("  A3F 9C2 "), "A3F-9C2");
});

test("normalizeCode rejects bad input", () => {
  assert.equal(normalizeCode(""), null);
  assert.equal(normalizeCode(null), null);
  assert.equal(normalizeCode("A3F-9C"), null);
  assert.equal(normalizeCode("A3F-9C2D"), null);
});

test("single card admits 1 person, double admits 2", () => {
  assert.equal(capacityOf("single"), 1);
  assert.equal(capacityOf("double"), 2);
  assert.equal(capacityOf(undefined), 1);
});

test("parseCardType understands common words", () => {
  for (const v of ["double", "DOUBLE", "2", "couple", "plus one", "+1"])
    assert.equal(parseCardType(v), "double");
  for (const v of ["single", "", "vip", undefined])
    assert.equal(parseCardType(v), "single");
});

test("clean trims, limits length and returns null for empty", () => {
  assert.equal(clean("  hi  "), "hi");
  assert.equal(clean("   "), null);
  assert.equal(clean(undefined), null);
  assert.equal(clean("abcdef", 3), "abc");
});

test("event link stays open until the end of the day after the event", () => {
  // "today" must be worked out in the app's own timezone (APP_TZ_OFFSET), not UTC
  const [, sign, hh, mm] = config.tzOffset.match(/([+-])(\d\d):(\d\d)/);
  const offsetMs =
    (sign === "-" ? -1 : 1) * (Number(hh) * 60 + Number(mm)) * 60000;
  const day = (offset) =>
    new Date(Date.now() + offsetMs + offset * 86400000)
      .toISOString()
      .slice(0, 10);
  assert.equal(
    isEventAccessOpen({ access_active: 1, event_date: day(0) }),
    true,
  ); // today
  assert.equal(
    isEventAccessOpen({ access_active: 1, event_date: day(-1) }),
    true,
  ); // yesterday: still open
  assert.equal(
    isEventAccessOpen({ access_active: 1, event_date: day(-3) }),
    false,
  ); // long past
  assert.equal(
    isEventAccessOpen({ access_active: 0, event_date: day(0) }),
    false,
  ); // switched off
  assert.ok(eventExpiry({ event_date: "2030-01-01" }) instanceof Date);
});

test("names are compared ignoring capitals, extra spaces and accents", () => {
  assert.equal(normName("  JOHN   Mwakyusa "), "john mwakyusa");
  assert.equal(normName("José"), "jose");
});

test("phone numbers match across formats", () => {
  assert.equal(normPhone("0712 345 678"), "712345678");
  assert.equal(normPhone("+255 712-345-678"), "712345678");
  assert.equal(normPhone("255712345678"), "712345678");
  assert.equal(normPhone(""), "");
  assert.equal(normPhone(null), "");
});

test("same guest = same name and same (or missing) phone", () => {
  assert.equal(
    isSameGuest(
      { full_name: "Asha Juma", phone: "0712345678" },
      { full_name: "ASHA  juma", phone: "+255712345678" },
    ),
    true,
  );
  assert.equal(
    isSameGuest(
      { full_name: "Asha Juma", phone: "" },
      { full_name: "Asha Juma", phone: "0712345678" },
    ),
    true,
  );
  assert.equal(
    isSameGuest(
      { full_name: "Asha Juma", phone: "0712345678" },
      { full_name: "Asha Juma", phone: "0755000111" },
    ),
    false,
  ); // two different Ashas
  assert.equal(
    isSameGuest(
      { full_name: "Asha Juma", phone: "0712345678" },
      { full_name: "Baraka Juma", phone: "0712345678" },
    ),
    false,
  ); // family sharing a phone
});
