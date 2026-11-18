import { expect, test } from "@playwright/test";

const tiers = ["easy","easy","medium","yds","yds"] as const;
function example(sentence:string, difficulty:(typeof tiers)[number], translation:string,focus:string){
  return {sentence,difficulty,translation,translationFocus:[focus]};
}
const nounExamples = [
  example("This approach saves time.","easy","Bu yaklaşım zaman kazandırır.","yaklaşım"),
  example("Our approach is simple.","easy","Yaklaşımımız basittir.","Yaklaşım"),
  example("Scientists use a systematic approach to evaluating new evidence.","medium","Bilim insanları yeni kanıtları değerlendirmede sistematik bir yaklaşım kullanır.","yaklaşım"),
  example("Although this approach appears effective, researchers acknowledge that further controlled trials are necessary before the findings can inform national policy.","yds","Bu yaklaşım etkili görünse de araştırmacılar bulguların ulusal politikaya yön vermesinden önce daha fazla kontrollü deney gerektiğini kabul eder.","yaklaşım"),
  example("A flexible approach to curriculum design may enable institutions to address widening educational inequalities while preserving the standards required for international accreditation.","yds","Müfredat tasarımına esnek bir yaklaşım, kurumların uluslararası akreditasyon standartlarını korurken büyüyen eğitim eşitsizliklerini ele almasını sağlayabilir.","yaklaşım"),
];
const verbExamples = [
  example("We approach the gate.","easy","Kapıya yaklaşırız.","yaklaşırız"),
  example("They approach the problem.","easy","Soruna yaklaşırlar.","yaklaşırlar"),
  example("Researchers approach the question from a historical perspective.","medium","Araştırmacılar soruya tarihsel bir perspektiften yaklaşır.","yaklaşır"),
  example("As public funding becomes less predictable, universities must approach long-term infrastructure planning with greater caution to protect essential academic services.","yds","Kamu finansmanı daha az öngörülebilir hâle geldikçe üniversiteler temel akademik hizmetleri korumak için uzun vadeli altyapı planlamasına daha dikkatli yaklaşmalıdır.","yaklaşmalıdır"),
  example("Educational authorities should approach curriculum reform as a sustained institutional process rather than an isolated response to short-term examination outcomes.","yds","Eğitim yetkilileri müfredat reformuna kısa vadeli sınav sonuçlarına tek seferlik tepki değil, sürekli bir kurumsal süreç olarak yaklaşmalıdır.","yaklaşmalıdır"),
];
const guestWord = {
  id:"e2e-tiered-approach",
  word:"Approach", partOfSpeech:"Noun", meanings:["yaklaşım"], alternatives:[],
  cefr:"B2",score:0,usageNote:"Test verisi — gerçek kullanıcıya yazılmaz.",
  examples:nounExamples,
  senses:[{partOfSpeech:"Verb", meanings:["yaklaşmak"],usageNote:"",cefr:"B2",examples:verbExamples}],
  pronunciationUk:"/əˈprəʊtʃ/",pronunciationUs:"/əˈproʊtʃ/",sourceUrl:"",
  createdAt:"2026-11-18T00:00:00.000Z",updatedAt:"2026-11-18T00:00:00.000Z",
};

test("guest library shows five 2/1/2 levels, preserves distinct Approach senses and stays mobile-safe",async ({page})=>{
  await page.addInitScript((word)=>{
    localStorage.setItem("yds-atlas-language","tr");
    localStorage.setItem("yds-atlas-words-v1",JSON.stringify([word]));
  },guestWord);
  await page.goto("/#library");
  await page.locator('button[aria-label="Approach kelime ayrıntıları"]:visible').first().click();
  const dialog=page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const primary=dialog.locator('[data-testid="word-example"]:visible');
  await expect(primary).toHaveCount(5);
  expect(await primary.evaluateAll(nodes=>nodes.map(node=>node.getAttribute("data-difficulty"))))
    .toEqual(["easy","easy","medium","yds","yds"]);
  const main=primary.first().getByTestId("sentence-word").filter({hasText:/approach/i}).first();
  await main.focus();
  await expect(primary.first().getByTestId("sentence-word-definition")).toContainText("yaklaşım");
  await page.keyboard.press("Escape");
  await expect(primary.first().getByTestId("sentence-word-definition")).toHaveCount(0);
  await expect(dialog).toBeVisible(); // Escape dismisses the tooltip, not WordDetails.

  const other=dialog.getByTestId("additional-word-sense");
  await other.locator("summary").click();
  const secondary=other.getByTestId("word-example");
  await expect(secondary).toHaveCount(5);
  expect(await secondary.evaluateAll(nodes=>nodes.map(node=>node.getAttribute("data-difficulty"))))
    .toEqual(["easy","easy","medium","yds","yds"]);
  const alternate=secondary.first().getByTestId("sentence-word").filter({hasText:/approach/i}).first();
  await alternate.focus();
  const tooltip=secondary.first().getByTestId("sentence-word-definition");
  await expect(tooltip).toContainText("yaklaşmak");
  await expect(tooltip).not.toContainText("yaklaşım");
  await page.keyboard.press("Escape");

  await page.screenshot({path:"test-results/tiered-details-"+test.info().project.name+".png"});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
});
