/**
 * UI strings. English and Hindi are built in (so the demo's language switch works offline);
 * other languages are translated once by Gemini through /api/i18n and cached in the browser.
 */
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "./api";

export const en = {
  tagline: "Cheap food and study spots you can reach by T right now. Collect stops, win the week for your school.",
  pickSchool: "Pick your school",
  schoolEmail: "Your school email",
  sendLink: "Send sign-in link",
  checkInbox: "Check your school inbox for the sign-in link.",
  devLink: "Dev mode: no email service is set up, so here's the link:",
  tryDemo: "Try the demo as",
  justLook: "Just look around",
  ownerPage: "I own a local spot",
  map: "Map",
  plan: "Plan",
  board: "Board",
  me: "Me",
  explore: "Explore",
  study: "Study",
  live: "Live",
  ride: "Ride",
  checkIn: "Check in",
  checkInHere: "Check in here",
  findStop: "Find a stop",
  nearest: "Nearest",
  campus: "Campus",
  budget: "Budget",
  craving: "Craving",
  vibe: "Vibe",
  openNow: "Open now",
  openLate: "Open past midnight",
  tasteOfHome: "Taste of home",
  under: "under",
  noSpots: "Nothing here matches. Try a bigger budget or fewer filters.",
  tryStation: "Nearest stop with cheap food:",
  freeHangouts: "Free hangouts",
  studySpots: "Study spots",
  localTips: "Local tips",
  leaveTip: "Leave a tip for the next student",
  helpful: "Helpful",
  report: "Report",
  collected: "Collected",
  notCollected: "Not collected yet",
  awayGame: "Away game: x2 here",
  neutralGround: "Neutral ground: +50 on the Blue Line",
  localPartner: "Local partner",
  sampleOffer: "Sample offer",
  estimate: "est.",
  walk: "min walk",
  takePhoto: "Snap a photo of your food or the place",
  retake: "Retake",
  submit: "Collect it",
  checkingPhoto: "Checking your photo…",
  demoLocation: "Demo: simulate being here (judging only)",
  tooFar: "Get within 150 m to check in.",
  youAre: "You're",
  away: "away",
  newStop: "New stop collected!",
  pointsEarned: "points",
  nice: "Nice!",
  done: "Done",
  streak: "week streak",
  streakSafe: "Safe this week",
  streakDue: "Collect a new stop by Sunday",
  streakSkip: "Your monthly skip will cover this week",
  level: "Level",
  weekPoints: "This week",
  schoolBoard: "School board",
  avgPerPlayer: "Avg per player",
  totalStops: "Stops collected",
  needsPlayers: "needs 10 active players to rank",
  resetsMonday: "Resets Monday",
  mySchool: "My school",
  friends: "Friends",
  demoNote: "Includes seeded demo players for the judging demo.",
  lineReliability: "Line reliability by hour",
  yourBoston: "Your Boston",
  moneySaved: "saved vs. eating near campus",
  neighborhoods: "neighborhoods",
  localSpots: "local spots supported",
  stamps: "Neighborhood stamps",
  lines: "Lines",
  badges: "Badges",
  punchCards: "Punch cards",
  redeem: "Redeem",
  showStaff: "Show this code to staff. It expires in",
  settings: "Settings",
  language: "Language",
  homeFood: "Food from home",
  myBudget: "My usual budget",
  myBaseline: "What a meal near campus costs me",
  contact: "Contact (shared only after both accept)",
  save: "Save",
  signOut: "Sign out",
  friendCode: "Your friend code",
  addFriend: "Add a friend by code",
  planTitle: "Stop Planner",
  planHint: "Tell me your budget, time and craving",
  planGo: "Plan it",
  agentSteps: "Agent steps",
  listingCheck: "Listing check",
  listingHint: "Paste any rental listing. We flag broker fees you may not owe and common scam signs.",
  checkIt: "Check listing",
  sublets: "Sublets",
  postSublet: "Post",
  mine: "Mine",
  neverPay: "Never pay before an in-person or live video viewing. No money moves through Line Collector.",
  rideSplit: "Late-Night Ride Split",
  rideSafety: "Same-school verified students only. Pickup at a public T station. Contact appears only after both accept. Fare split happens in your own payment app.",
  lineStatus: "Live line status",
  chaos: "Chaos",
  shuttle: "Shuttle",
  postRide: "Post a ride",
  join: "Join",
  share: "Share trip",
  block: "Block",
  accept: "Accept",
  decline: "Decline",
  close: "Close",
  back: "Back",
  signInToCollect: "Sign in with your school email to collect stops.",
  rent: "Typical rent nearby",
  noRent: "No cached rent data for this area yet.",
};
export type Key = keyof typeof en;

const hi: Record<Key, string> = {
  tagline: "अभी T से पहुँचने लायक सस्ता खाना और पढ़ाई की जगहें। स्टॉप इकट्ठा करें, अपने स्कूल के लिए हफ़्ता जीतें।",
  pickSchool: "अपना स्कूल चुनें",
  schoolEmail: "आपका स्कूल ईमेल",
  sendLink: "साइन-इन लिंक भेजें",
  checkInbox: "साइन-इन लिंक के लिए अपना स्कूल इनबॉक्स देखें।",
  devLink: "डेव मोड: ईमेल सेवा सेट नहीं है, इसलिए लिंक यह है:",
  tryDemo: "डेमो आज़माएँ:",
  justLook: "बस देखें",
  ownerPage: "मेरी एक लोकल दुकान है",
  map: "नक्शा",
  plan: "प्लान",
  board: "बोर्ड",
  me: "मैं",
  explore: "खोजें",
  study: "पढ़ाई",
  live: "रहना",
  ride: "सफ़र",
  checkIn: "चेक इन",
  checkInHere: "यहाँ चेक इन करें",
  findStop: "स्टॉप खोजें",
  nearest: "सबसे पास",
  campus: "कैंपस",
  budget: "बजट",
  craving: "मन क्या है",
  vibe: "माहौल",
  openNow: "अभी खुला",
  openLate: "आधी रात के बाद खुला",
  tasteOfHome: "घर का स्वाद",
  under: "से कम",
  noSpots: "यहाँ कुछ मेल नहीं खाता। बजट बढ़ाएँ या फ़िल्टर कम करें।",
  tryStation: "सस्ते खाने वाला सबसे पास का स्टॉप:",
  freeHangouts: "मुफ़्त घूमने की जगहें",
  studySpots: "पढ़ाई की जगहें",
  localTips: "लोकल टिप्स",
  leaveTip: "अगले छात्र के लिए एक टिप छोड़ें",
  helpful: "मददगार",
  report: "रिपोर्ट करें",
  collected: "इकट्ठा किया",
  notCollected: "अभी इकट्ठा नहीं किया",
  awayGame: "अवे गेम: यहाँ x2",
  neutralGround: "न्यूट्रल ग्राउंड: ब्लू लाइन पर +50",
  localPartner: "लोकल पार्टनर",
  sampleOffer: "सैंपल ऑफ़र",
  estimate: "अनुमान",
  walk: "मिनट पैदल",
  takePhoto: "अपने खाने या जगह की फ़ोटो लें",
  retake: "दोबारा लें",
  submit: "इकट्ठा करें",
  checkingPhoto: "आपकी फ़ोटो जाँची जा रही है…",
  demoLocation: "डेमो: यहाँ होने का अनुकरण (सिर्फ़ जजिंग के लिए)",
  tooFar: "चेक इन के लिए 150 मीटर के अंदर आएँ।",
  youAre: "आप",
  away: "दूर हैं",
  newStop: "नया स्टॉप इकट्ठा हुआ!",
  pointsEarned: "पॉइंट",
  nice: "बढ़िया!",
  done: "हो गया",
  streak: "हफ़्ते की स्ट्रीक",
  streakSafe: "इस हफ़्ते सुरक्षित",
  streakDue: "रविवार तक एक नया स्टॉप इकट्ठा करें",
  streakSkip: "आपकी मासिक छूट इस हफ़्ते को कवर करेगी",
  level: "लेवल",
  weekPoints: "इस हफ़्ते",
  schoolBoard: "स्कूल बोर्ड",
  avgPerPlayer: "प्रति खिलाड़ी औसत",
  totalStops: "इकट्ठे स्टॉप",
  needsPlayers: "रैंक के लिए 10 सक्रिय खिलाड़ी चाहिए",
  resetsMonday: "सोमवार को रीसेट",
  mySchool: "मेरा स्कूल",
  friends: "दोस्त",
  demoNote: "जजिंग डेमो के लिए बनाए गए डेमो खिलाड़ी शामिल हैं।",
  lineReliability: "घंटे के हिसाब से लाइन की विश्वसनीयता",
  yourBoston: "आपका बॉस्टन",
  moneySaved: "कैंपस के पास खाने की तुलना में बचत",
  neighborhoods: "मोहल्ले",
  localSpots: "लोकल दुकानों का साथ",
  stamps: "मोहल्ले के स्टैम्प",
  lines: "लाइनें",
  badges: "बैज",
  punchCards: "पंच कार्ड",
  redeem: "रिडीम करें",
  showStaff: "यह कोड स्टाफ़ को दिखाएँ। यह इतने समय में खत्म होगा:",
  settings: "सेटिंग्स",
  language: "भाषा",
  homeFood: "घर का खाना",
  myBudget: "मेरा सामान्य बजट",
  myBaseline: "कैंपस के पास एक खाने का खर्च",
  contact: "संपर्क (दोनों के स्वीकार करने के बाद ही दिखेगा)",
  save: "सेव करें",
  signOut: "साइन आउट",
  friendCode: "आपका फ़्रेंड कोड",
  addFriend: "कोड से दोस्त जोड़ें",
  planTitle: "स्टॉप प्लानर",
  planHint: "अपना बजट, समय और मन बताइए",
  planGo: "प्लान बनाएँ",
  agentSteps: "एजेंट के कदम",
  listingCheck: "लिस्टिंग जाँच",
  listingHint: "कोई भी किराये की लिस्टिंग पेस्ट करें। हम वह ब्रोकर फ़ीस बताएँगे जो शायद आप पर बकाया नहीं है, और आम धोखाधड़ी के संकेत।",
  checkIt: "लिस्टिंग जाँचें",
  sublets: "सबलेट",
  postSublet: "पोस्ट करें",
  mine: "मेरे",
  neverPay: "घर को खुद या लाइव वीडियो पर देखे बिना कभी पैसे न दें। Line Collector से कोई पैसा नहीं जाता।",
  rideSplit: "देर रात की राइड शेयर",
  rideSafety: "सिर्फ़ उसी स्कूल के सत्यापित छात्र। पिकअप किसी सार्वजनिक T स्टेशन पर। दोनों के स्वीकार करने के बाद ही संपर्क दिखेगा। किराया अपने पेमेंट ऐप से बाँटें।",
  lineStatus: "लाइनों की लाइव स्थिति",
  chaos: "अफ़रातफ़री",
  shuttle: "शटल",
  postRide: "राइड पोस्ट करें",
  join: "जुड़ें",
  share: "यात्रा शेयर करें",
  block: "ब्लॉक करें",
  accept: "स्वीकार करें",
  decline: "मना करें",
  close: "बंद करें",
  back: "वापस",
  signInToCollect: "स्टॉप इकट्ठा करने के लिए अपने स्कूल ईमेल से साइन इन करें।",
  rent: "आसपास का आम किराया",
  noRent: "इस इलाके का किराया डेटा अभी कैश नहीं है।",
};

export const LANGS = [
  { code: "en", label: "English" },
  { code: "hi", label: "हिन्दी" },
  { code: "zh", label: "中文" },
  { code: "es", label: "Español" },
  { code: "ko", label: "한국어" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "pt", label: "Português" },
  { code: "ar", label: "العربية" },
];

type Ctx = { lang: string; setLang: (l: string) => void; t: (k: Key) => string; translating: boolean };
const I18n = createContext<Ctx>({ lang: "en", setLang: () => {}, t: (k) => en[k], translating: false });

function loadCached(lang: string): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(`lc-i18n-${lang}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: string }) {
  const [lang, setLangState] = useState(() => {
    try {
      return initial || localStorage.getItem("lc-lang") || "en";
    } catch {
      return initial || "en";
    }
  });
  const [table, setTable] = useState<Record<string, string>>(() => (lang === "hi" ? hi : lang === "en" ? en : loadCached(lang) ?? en));
  const [translating, setTranslating] = useState(false);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    if (lang === "en") return setTable(en);
    if (lang === "hi") return setTable(hi);
    const cached = loadCached(lang);
    if (cached) return setTable(cached);
    setTranslating(true);
    api
      .post<{ strings: Record<string, string>; ai: boolean }>("/i18n", { lang, strings: en })
      .then((r) => {
        setTable(r.strings);
        if (r.ai) {
          try {
            localStorage.setItem(`lc-i18n-${lang}`, JSON.stringify(r.strings));
          } catch {
            /* storage unavailable */
          }
        }
      })
      .catch(() => setTable(en))
      .finally(() => setTranslating(false));
  }, [lang]);

  const setLang = useCallback((l: string) => {
    setLangState(l);
    try {
      localStorage.setItem("lc-lang", l);
    } catch {
      /* storage unavailable */
    }
  }, []);
  const t = useCallback((k: Key) => table[k] ?? en[k], [table]);
  return <I18n.Provider value={{ lang, setLang, t, translating }}>{children}</I18n.Provider>;
}

export const useI18n = () => useContext(I18n);
