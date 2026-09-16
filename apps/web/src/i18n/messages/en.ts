export const en = {
  nav: { exchanges: "Exchanges", guides: "Guides", wallet: "Wallet" },
  home: {
    eyebrow: "Crypto affiliate cashback",
    title: "Keep more of every trading fee.",
    lead: "Compare verified exchange offers, link your UID, and follow each cashback movement from commission to withdrawal.",
    flexible: "Flexible",
    viewOffer: "View offer",
    empty: "Start PostgreSQL and run the seed command to load exchange offers.",
    statsTitle: "Why choose us?",
    statsUsers: "Users",
    statsCountries: "Countries",
    statsExchanges: "Exchanges",
    ledgerTitle: "Online Rebate Ledger",
    ledgerLead: "Once live, this table updates daily from published affiliate reports. You'll be able to check your own balance in your wallet.",
    ledgerDemoBadge: "Illustrative example — not live data",
    ledgerColExchange: "Exchange",
    ledgerColRate: "Rate",
    ledgerColUid: "UID",
    ledgerColRebate: "Rebate",
    ledgerColDate: "Date"
  },
  exchanges: {
    eyebrow: "Published partners",
    title: "Compare exchanges.",
    upTo: "Up to",
    exampleLabel: "Example",
    exampleTemplate: "$100 fee \u2192 ${{amount}} back",
    cashbackLabel: "Spot & futures cashback",
    conditionsFallback: "On eligible affiliate commission after the holding period.",
    getLink: "Get referral link",
    empty: "No published offers yet."
  },
  exchange: { eyebrow: "Exchange offer" },
  guides: { eyebrow: "Knowledge base", title: "Cashback guides.", general: "General", empty: "No published guides yet." },
  guide: { eyebrow: "Guide", comingSoon: "Content coming soon." },
  siteFooter: {
    brand: "Cashback Hub",
    tagline: "Crypto exchange cashback, made transparent.",
    columns: [
      { title: "Resources", items: ["Getting started", "How cashback works", "Supported exchanges", "FAQ"] },
      { title: "Company", items: ["About us", "Blog", "Careers", "Contact"] },
      { title: "Legal", items: ["Terms of service", "Privacy policy", "Cookie policy", "Risk disclosure"] },
      { title: "Community", items: ["Telegram", "Discord", "Twitter / X", "Newsletter"] }
    ],
    disclaimer: "Cashback balances are based on published affiliate reports.",
    placeholderNote: "Pages coming soon — every link below returns to the homepage for now."
  }
} as const;
