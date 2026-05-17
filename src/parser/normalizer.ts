export function normalizeQuery(query: string): string {
  return query
    .toLowerCase()
    .replace(/rtx\s*/gi, "rtx ")
    .replace(/gtx\s*/gi, "gtx ")
    .replace(/\s+/g, " ")
    .trim();
}
