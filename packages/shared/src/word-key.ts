export function wordKey(value: string) {
  return value.trim().replace(/\s+/g, " ").replace(/[’‘]/g, "'").toLocaleLowerCase("en-US");
}
