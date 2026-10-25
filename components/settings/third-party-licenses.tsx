"use client";

import { useEffect, useState } from "react";
import { FormInput } from "@/components/primitives/form-input";
import { LoadingSkeleton } from "@/components/primitives/loading-skeleton";

interface LicenseEntry {
  name: string;
  version: string;
  license: string;
  author?: string;
}

/**
 * The runtime dependencies and their licenses, from `public/licenses.json` (written at build time
 * by `scripts/gen-licenses.ts`), with a filter.
 *
 * @example
 * <ThirdPartyLicenses />
 */
export function ThirdPartyLicenses() {
  const [licenses, setLicenses] = useState<LicenseEntry[]>();
  const [filterText, setFilterText] = useState("");
  useEffect(() => {
    let isCurrent = true;
    fetch("/licenses.json")
      .then((response) => (response.ok ? (response.json() as Promise<LicenseEntry[]>) : []))
      .then((loadedLicenses) => {
        if (isCurrent) setLicenses(loadedLicenses);
      })
      .catch(() => {
        if (isCurrent) setLicenses([]);
      });
    return () => {
      isCurrent = false;
    };
  }, []);
  if (!licenses) return <LoadingSkeleton rows={4} label="Loading licenses…" />;
  if (licenses.length === 0)
    return <p className="text-foreground-subtle">The license list is created when CMM is built.</p>;
  const visibleLicenses = licenses.filter((entry) =>
    entry.name.toLowerCase().includes(filterText.trim().toLowerCase()),
  );
  return (
    <div data-testid="third-party-licenses">
      <FormInput
        aria-label="Filter packages"
        placeholder={`Filter ${licenses.length} packages`}
        value={filterText}
        onChange={(changeEvent) => setFilterText(changeEvent.target.value)}
        className="mb-3 max-w-sm"
      />
      <ul className="max-h-80 divide-y divide-line/40 overflow-y-auto text-sm">
        {visibleLicenses.map((entry) => (
          <li key={entry.name} className="flex flex-wrap gap-x-3 py-1.5">
            <span className="font-medium">{entry.name}</span>
            <span className="text-foreground-subtle">{entry.version}</span>
            {entry.author && <span className="text-foreground-muted">{entry.author}</span>}
            <span className="ml-auto text-xs text-foreground-subtle">{entry.license}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
