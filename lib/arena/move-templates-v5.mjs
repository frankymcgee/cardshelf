/** Reviewed whole-text aliases for existing V5 operations. Each template binds
 * its own parameters; move names never authorize or select an implementation.
 * These are intentionally complete sentences, not lossy phrase replacements. */
const templates = Object.freeze([
  {
    id: 'legacy-coin-bonus',
    pattern: /^Flip a coin\. If heads, this attack does (\d+) damage plus (\d+) more damage\.$/,
    render: (match, attack) => {
      const printed = String(attack.damage ?? '').match(/^(\d+)\+$/);
      // Older text repeats the printed base. A mismatching base is ambiguous.
      if (!printed || Number(printed[1]) !== Number(match[1])) return null;
      return `Flip a coin. If heads, this attack does ${match[2]} more damage.`;
    },
  },
  {
    id: 'legacy-recoil',
    pattern: /^This Pokemon does (\d+) damage to itself\.$/,
    render: match => `This Pokemon also does ${match[1]} damage to itself.`,
  },
  {
    id: 'legacy-bench-damage',
    pattern: /^Does (\d+) damage to 1 of your opponent's Benched Pokemon\. \(Don't apply Weakness and Resistance for Benched Pokemon\.\)$/,
    render: match => `This attack also does ${match[1]} damage to 1 of your opponent's Benched Pokemon. (Don't apply Weakness and Resistance for Benched Pokemon.)`,
  },
]);

export function reviewedMoveText(attack, original) {
  for (const template of templates) {
    const match = original.match(template.pattern);
    if (match) return template.render(match, attack) ?? original;
  }
  return original;
}
