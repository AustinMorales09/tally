"use client";

import { useEffect, useState } from "react";

/**
 * Time zone picker that defaults to the browser's zone when no value is set.
 * The full zone list is loaded after mount, because the server's and the browser's lists can differ
 * and would otherwise cause a hydration mismatch.
 */
export default function TimezoneSelect({ value, name = "timezone" }: { value?: string; name?: string }) {
  const [tz, setTz] = useState(value ?? "America/New_York");
  const [zones, setZones] = useState<string[]>([]);
  useEffect(() => {
    setZones(typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : []);
    if (!value) setTz(Intl.DateTimeFormat().resolvedOptions().timeZone || "America/New_York");
  }, [value]);
  const options = zones.includes(tz) ? zones : [tz, ...zones];
  return (
    <select id={name} name={name} value={tz} onChange={(e) => setTz(e.target.value)}>
      {options.map((z) => (
        <option key={z} value={z}>{z.replace(/_/g, " ")}</option>
      ))}
    </select>
  );
}
