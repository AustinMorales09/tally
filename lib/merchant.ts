// Turning bank descriptions into a stable merchant key, so "NETFLIX.COM 866-579-7172 CA" in January and
// "NETFLIX.COM 866-716-0414 CA" in March group together.

/** Payment processors that put the real merchant after a "*": "PAYPAL *ADOBE", "SQ *BLUE BOTTLE", "GOOGLE *YouTube". */
const PROCESSORS = new Set(["PAYPAL", "PP", "SQ", "TST", "GOOGLE", "APL", "SP", "DD", "IC", "PY", "EB", "WPY", "BT", "FS", "CKO", "LS", "PADDLE", "STRIPE"]);
/** Bank boilerplate that comes before the merchant name. */
const LEADING = new Set(["POS", "DEBIT", "CREDIT", "PURCHASE", "RECURRING", "CHECKCARD", "CHECK", "CARD", "ACH", "ONLINE", "PREAUTHORIZED", "PRE", "AUTH", "VISA", "MC", "DDA", "WITHDRAWAL", "ELECTRONIC", "WEB", "AUTOPAY", "BILLPAY", "PMT", "XFER", "INTL", "SALE", "TRANSACTION", "PAYMENT", "TO", "FROM", "ZELLE", "VENMO", "CASHAPP", "CASH", "APP"]);
const TRAILING = new Set(["US", "USA", "INC", "LLC", "LTD", "CO", "CORP", "COM", "NET", "ORG", "IO", "HTTPS", "WWW", "HELP", "BILLING", "PURCHASE", "PMT", "SUBSCRIPTION", "SUBSCR", "SUB", "MEMBERSHIP", "MONTHLY", "ANNUAL", "RENEWAL", "PLAN", "AI"]);
const STATES = new Set("AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC GB UK IE NL LU CAN".split(" "));

export function merchantKey(description: string): string {
  let s = description.toUpperCase();
  const star = s.indexOf("*");
  if (star > 0) {
    const before = s.slice(0, star).trim();
    const lastWord = before.split(/\s+/).pop() ?? "";
    s = PROCESSORS.has(before) || PROCESSORS.has(lastWord) ? s.slice(star + 1) : before;
  }
  s = s.replace(/\b(WWW\.)/g, "").replace(/\.(COM|NET|ORG|IO|CO|TV|APP|AI|ME|FM|GG)\b/g, " ");
  let tokens = s.split(/[^A-Z0-9&]+/).filter((t) => t && !/\d/.test(t) && t !== "&");
  while (tokens.length > 1 && LEADING.has(tokens[0])) tokens.shift();
  while (tokens.length > 1 && (TRAILING.has(tokens[tokens.length - 1]) || STATES.has(tokens[tokens.length - 1]))) tokens.pop();
  tokens = tokens.slice(0, 3);
  return tokens.join(" ") || description.toUpperCase().replace(/\s+/g, " ").trim().slice(0, 40);
}

const KNOWN: Record<string, string> = { "APPLE BILL": "Apple (App Store / iCloud)", "AMZN": "Amazon", "AMAZON PRIME": "Amazon Prime", "HBO MAX": "Max", "YOUTUBE": "YouTube Premium" };

export function displayName(key: string): string {
  if (KNOWN[key]) return KNOWN[key];
  return key.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/\bTv\b/, "TV").slice(0, 60);
}

const CATEGORY_HINTS: [RegExp, string][] = [
  [/NETFLIX|HULU|DISNEY|HBO|MAX|PEACOCK|PARAMOUNT|YOUTUBE|CRUNCHYROLL|SLING|FUBO|APPLE TV|PRIME VIDEO/, "Streaming"],
  [/SPOTIFY|PANDORA|TIDAL|SIRIUS|AUDIBLE|DEEZER|APPLE MUSIC/, "Music"],
  [/ADOBE|MICROSOFT|GITHUB|NOTION|FIGMA|CANVA|DROPBOX|GOOGLE|OPENAI|CLAUDE|ANTHROPIC|ZOOM|SLACK|1PASSWORD|LASTPASS|JETBRAINS|GRAMMARLY|EVERNOTE|TODOIST/, "Software"],
  [/ICLOUD|APPLE BILL|BACKBLAZE|AWS|DIGITALOCEAN|NAMECHEAP|GODADDY|SQUARESPACE|WIX|NETLIFY|VERCEL/, "Cloud & storage"],
  [/TIMES|POST|JOURNAL|ECONOMIST|SUBSTACK|MEDIUM|KINDLE|ATLANTIC|PATREON/, "News & reading"],
  [/FITNESS|GYM|PELOTON|STRAVA|CLASSPASS|YMCA|ORANGETHEORY|EQUINOX|HEADSPACE|CALM/, "Fitness"],
  [/XBOX|PLAYSTATION|NINTENDO|STEAM|EA PLAY|TWITCH/, "Gaming"],
  [/VERIZON|AT&T|T MOBILE|TMOBILE|COMCAST|XFINITY|SPECTRUM|MINT MOBILE|VISIBLE|GOOGLE FI/, "Phone & internet"],
  [/HELLOFRESH|BLUE APRON|DOORDASH|DASHPASS|UBER ONE|INSTACART|GRUBHUB/, "Food"],
  [/AMAZON PRIME|AMZN|COSTCO|WALMART|TARGET CIRCLE|CHEWY/, "Shopping"],
  [/GEICO|PROGRESSIVE|STATE FARM|ALLSTATE|LEMONADE|INSURANCE/, "Insurance"],
  [/ELECTRIC|ENERGY|WATER|GAS CO|UTILIT/, "Utilities"],
];
export function guessCategory(key: string): string {
  return CATEGORY_HINTS.find(([re]) => re.test(key))?.[1] ?? "Other";
}
