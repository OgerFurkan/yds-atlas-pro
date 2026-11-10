export interface SpellcheckResult {
  normalized: string;
  casingChanged: boolean;
  isCorrect: boolean;
  suggestions: string[];
}
