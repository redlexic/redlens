/** Parse a JSON meta string attached to a Participant or RelationEdge (.m field).
 *  Returns null for missing/empty/unparseable values rather than throwing. */
export function parseMeta<T>(m: string | undefined): T | null {
  if (!m) return null;
  try {
    return JSON.parse(m) as T;
  } catch {
    return null;
  }
}
