const HTML_TAGS = /<[^>]*>/g;
const ENTITIES = /&(lt|gt|amp|quot|#39|#x27);/g;

const ENTITY_MAP: Record<string, string> = {
  lt: "<",
  gt: ">",
  amp: "&",
  quot: '"',
  "#39": "'",
  "#x27": "'",
};

export function sanitize(input: string | null | undefined): string {
  if (!input) return "";
  return input
    .replace(HTML_TAGS, "")
    .replace(ENTITIES, (_, entity) => ENTITY_MAP[entity] ?? "")
    .trim();
}
