// Verified abbreviations from the user's paper-pdf-naming skill. Never derive an abbreviation from initials.
const entries: [string, string[], string[]][] = [
  ['Proc Natl Acad Sci USA', ['Proceedings of the National Academy of Sciences', 'Proceedings of the National Academy of Sciences of the United States of America', 'PNAS'], ['0027-8424', '1091-6490']],
  ['Atmos Chem Phys', ['Atmospheric Chemistry and Physics'], ['1680-7316', '1680-7324']],
  ['J Atmos Sci', ['Journal of the Atmospheric Sciences'], ['0022-4928', '1520-0469']],
  ['J Clim', ['Journal of Climate'], ['0894-8755', '1520-0442']],
  ['J Adv Model Earth Syst', ['Journal of Advances in Modeling Earth Systems'], ['1942-2466']],
  ['J Fluid Mech', ['Journal of Fluid Mechanics'], ['0022-1120', '1469-7645']],
  ['Mon Wea Rev', ['Monthly Weather Review'], ['0027-0644', '1520-0493']],
  ['Nature', ['Nature'], ['0028-0836', '1476-4687']]
];
export const journalKey = (s: string) => s.normalize('NFC').toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
export function abbreviation(full: string, issn: string[] = [], custom: Record<string, string> = {}, supplied = ''): string {
  const keys = [full, ...issn].map(journalKey);
  const override = Object.entries(custom).find(([key]) => keys.includes(journalKey(key)));
  if (override) return override[1].replace(/\./g, '').trim();
  const found = entries.find(([short, names, ids]) => [short, ...names, ...ids].some(n => keys.includes(journalKey(n))));
  return (found?.[0] || supplied).replace(/\./g, '').replace(/\s+/g, ' ').trim();
}
