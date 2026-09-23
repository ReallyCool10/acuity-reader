/**
 * Sanitizes a title string by stripping web domains, shadow-library download tags,
 * publication years, and malformed trailing download artifacts.
 */
export function cleanTitleString(raw: string): string {
  if (!raw) return '';
  let s = raw;

  // 1. Strip domain/website/shadow-library tags in parentheses or brackets:
  // e.g. (zblibrary.sk1lib.sk, z-lib.sk), (z-lib.org), [libgen.li], (oceanofpdf.com), (annas-archive)
  s = s.replace(
    /[([\]\s*[^)\]]*(?:zblibrary|z-lib|zlib|1lib|b-ok|libgen|oceanofpdf|annas-archive|pdfdrive|sk1lib|\.(?:sk|org|com|net|ru|io|is|to|me|li|in|la|rs|ec|lc|gd|info))\b[^)\]]*[)\]]/gi,
    ' '
  );

  // 2. Strip publication year / edition tags in parentheses or brackets:
  // e.g. (2011 etc.), (2011, Penguin), (2019), [2020]
  s = s.replace(
    /[([\]\s*(?:(?:19|20)\d{2}(?:\s*(?:etc\.?|edition|ed\.?|publisher|pub\.?|,.*))?)\s*[)\]]/gi,
    ' '
  );

  // 3. Strip loose etc., edition, revised tags in parentheses or brackets
  s = s.replace(/[([\]\s*(?:(?:\d+(?:st|nd|rd|th)\s+)?(?:edition|ed\.?)|etc\.?|revised(?:\s+ed\.?)?)\s*[)\]]/gi, ' ');

  // 4. Strip stray unbalanced trailing patterns from downloads: e.g. '2011 etc.)', 'z-lib.sk)'
  s = s.replace(/(?:[\s,_-]+|\()(?:\d{4}\s+etc\.?|etc\.?|z-lib[^)]*|zblibrary[^)]*)\)+/gi, ' ');

  // 5. Strip empty leftover parentheses or brackets
  s = s.replace(/[([\]\s*[)\]]/g, ' ');

  // 6. Strip trailing punctuation, dashes, spaces
  s = s.replace(/[\s\-_–—]+$/, '').trim();

  // 7. Collapse multiple spaces into one
  s = s.replace(/\s{2,}/g, ' ').trim();

  return s;
}

/**
 * Strips leading track numbers, separates author and title, and eliminates
 * shadow-library and edition artifacts from a filename.
 */
export function cleanTitle(filename: string): { title: string; author: string } {
  const nameWithoutExt = filename.substring(0, filename.lastIndexOf('.')) || filename;

  // Strip leading track numbers like '01 - ', '01. ', '1-02 '
  let s = nameWithoutExt.replace(/^(\d+[\s._-]+)+/i, '').trim();

  // Clean shadow tags, web links, trailing year metadata
  s = cleanTitleString(s);

  // Split Author and Title on ' - ' (dash with spaces or em-dash)
  const dashParts = s.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    const first = dashParts[0].trim();
    const rest = dashParts.slice(1).join(' - ').trim();
    if (!rest) {
      return { title: first, author: '' };
    }
    return { author: first, title: rest };
  }

  // Look for 'Title (Author)'
  const parenMatch = s.match(/^([^(]+)\s*\(([^)]+)\)$/);
  if (parenMatch) {
    return { title: parenMatch[1].trim(), author: parenMatch[2].trim() };
  }

  return { title: s, author: '' };
}
