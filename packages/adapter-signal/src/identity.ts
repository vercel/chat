const SIGNAL_PHONE_NUMBER_PATTERN = /^\+[1-9]\d{6,14}$/;

export class SignalIdentityMap {
  private readonly aliases = new Map<string, string>();

  canonicalize(value: string): string {
    const normalized = value.trim();
    if (!normalized) {
      return normalized;
    }

    const visited = new Set<string>();
    let current = normalized;

    while (!visited.has(current)) {
      visited.add(current);
      const aliased = this.aliases.get(current);
      if (!aliased || aliased === current) {
        return current;
      }
      current = aliased;
    }

    return current;
  }

  registerAliases(
    ...identifiers: Array<string | null | undefined>
  ): string | undefined {
    const normalized = identifiers
      .map((id) => (id ? id.trim() : undefined))
      .filter((id): id is string => Boolean(id));

    if (normalized.length === 0) {
      return undefined;
    }

    const canonicalCandidate =
      normalized.find((id) => isPhoneNumber(id)) ?? normalized[0];

    if (!canonicalCandidate) {
      return undefined;
    }

    const canonical = this.canonicalize(canonicalCandidate);

    for (const id of normalized) {
      this.aliases.set(id, canonical);
    }

    return canonical;
  }
}

export function isPhoneNumber(value: string): boolean {
  return SIGNAL_PHONE_NUMBER_PATTERN.test(value);
}
