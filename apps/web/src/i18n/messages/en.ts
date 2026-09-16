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
    exampleTemplate: "$100 affiliate commission \u2192 ${{amount}} back",
    cashbackLabel: "Spot & futures cashback",
    conditionsFallback: "On eligible affiliate commission after the holding period.",
    getLink: "Get referral link",
    empty: "No published offers yet."
  },
  exchange: { eyebrow: "Exchange offer" },
  cashback: {
    signedInAs: "Signed in as", signOut: "Sign out",
    title: "Your cashback", lead: "Track your Bybit cashback in one place.",
    signIn: "Sign in to check cashback", guest: "Registered through our Bybit referral link? Sign in and link your UID to follow your cashback.",
    available: "Available", pending: "Pending", reserved: "Withdrawal processing", withdrawn: "Paid out", receivable: "Adjustment to recover",
    noData: "Waiting for a published Bybit report. This is not a zero balance.",
    noUid: "Link your Bybit UID to start tracking your cashback.",
    uidLabel: "Bybit UID", linkUid: "Link UID", linking: "Linking…", linkAdded: "UID submitted. Ownership review and a published affiliate report are required before cashback is credited.",
    pendingOwnership: "Awaiting ownership review", pendingReport: "Awaiting affiliate report", verified: "Verified", rejected: "Needs support review",
    uidHelp: "Use your Bybit account UID, not a referral code. Keep any leading zeros. An admin will confirm account ownership.",
    unavailable: "Cashback is temporarily unavailable. Please try again.",
    lastImport: "Last report published", sourceAsOf: "Source data as of", unknown: "Not provided",
    wallet: "View wallet and history", refresh: "Refresh", loading: "Updating…", history: "Cashback history", more: "Load older activity",
    emptyHistory: "No cashback movements yet.", date: "Date", movement: "Movement", amount: "Amount",
    holdNote: "Pending cashback becomes available after the configured holding period. Amounts are shown separately for each currency.",
    labels: { CREDIT: "Cashback credited", HOLD_RELEASE: "Became available", REVERSAL: "Report correction", CLAWBACK: "Recovery adjustment", ADJUSTMENT: "Reconciled", WITHDRAWAL_RESERVE: "Withdrawal reserved", WITHDRAWAL_RELEASE: "Withdrawal released", WITHDRAWAL_SETTLE: "Withdrawal paid" }
  },
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
